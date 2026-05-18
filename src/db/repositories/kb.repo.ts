/**
 * KB repository — acesso a `kb_articles` e `kb_categories` no Postgres.
 *
 * Cada função recebe o executor (`db` ou `tx`) como primeiro parâmetro para
 * permitir que serviços orquestrem múltiplas operações dentro da mesma
 * transação. Consultas são parametrizadas e retornam linhas brutas — regras
 * de visibilidade adicionais (RBAC, sanitização de markdown, etc.) ficam na
 * camada de serviço.
 *
 * Para a busca textual usamos `ILIKE` em `title` e `body`. Mantém o repo livre
 * de extensões (não exige `pg_trgm` nem colunas `tsvector` na migration atual)
 * e cobre R13.3 — uma futura migração pode trocar por `to_tsvector` sem
 * alterar o consumidor, pois a assinatura permanece a mesma.
 *
 * Validates: R13.
 */

import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";

import type { Database } from "@/db/client";
import { kbArticles, kbCategories } from "@/db/schema";

/** Linha bruta de `kb_articles` conforme retornada pelo Drizzle. */
export type KbArticleRow = typeof kbArticles.$inferSelect;

/** Linha bruta de `kb_categories` conforme retornada pelo Drizzle. */
export type KbCategoryRow = typeof kbCategories.$inferSelect;

/** Payload aceito por `insertArticle`, refletindo as colunas inseríveis. */
export type KbArticleInsert = typeof kbArticles.$inferInsert;

/**
 * Linha enriquecida usada nas sugestões da KB (R13.8).
 *
 * Combina dados essenciais do artigo com o rótulo e ícone da categoria
 * — colhidos via `JOIN` com `kb_categories` — para que o consumidor
 * possa renderizar o item sem um round-trip adicional.
 */
export interface KbSuggestionRow {
    id: string;
    slug: string;
    title: string;
    categoryId: string;
    categoryLabel: string;
    categoryIcon: string;
}

/**
 * Opções para `listArticles`.
 *
 * - `publishedOnly` (default `true`): restringe a artigos com `published=true`.
 * - `authorId`: quando informado em conjunto com `publishedOnly=true`, também
 *   inclui rascunhos (`published=false`) cujo autor é esse usuário (R13.2).
 * - `categoryId`: restringe a artigos da categoria informada.
 * - `search`: termo aplicado via `ILIKE` em `title` e `body` (R13.3). Resultados
 *   com correspondência no título são considerados mais relevantes que os de
 *   correspondência apenas no corpo.
 * - `limit`: limite máximo de linhas retornadas. Útil para sugestões (R13.8).
 */
export interface ListArticlesOptions {
    publishedOnly?: boolean;
    authorId?: string;
    categoryId?: string;
    search?: string;
    limit?: number;
}

/**
 * Lista artigos da base de conhecimento com filtros opcionais.
 *
 * Quando `search` está presente, a ordenação prioriza correspondências no
 * título e usa `updated_at` como desempate. Caso contrário, devolve os mais
 * recentemente atualizados primeiro.
 */
export async function listArticles(
    db: Database,
    opts: ListArticlesOptions = {},
): Promise<KbArticleRow[]> {
    const {
        publishedOnly = true,
        authorId,
        categoryId,
        search,
        limit,
    } = opts;

    const filters: SQL[] = [];

    if (publishedOnly) {
        if (authorId) {
            // Publicados OU rascunhos do próprio autor (R13.1, R13.2).
            const visibility = or(
                eq(kbArticles.published, true),
                eq(kbArticles.authorId, authorId),
            );
            if (visibility) {
                filters.push(visibility);
            }
        } else {
            filters.push(eq(kbArticles.published, true));
        }
    }

    if (categoryId) {
        filters.push(eq(kbArticles.categoryId, categoryId));
    }

    if (search && search.trim().length > 0) {
        const pattern = `%${escapeLike(search.trim())}%`;
        const textMatch = or(
            ilike(kbArticles.title, pattern),
            ilike(kbArticles.body, pattern),
        );
        if (textMatch) {
            filters.push(textMatch);
        }
    }

    const whereClause =
        filters.length === 0
            ? undefined
            : filters.length === 1
                ? filters[0]
                : and(...filters);

    // Ordenação por relevância textual aproximada quando há busca:
    // título com match (0) vem antes de corpo com match (1); empate resolvido
    // pelo `updated_at` mais recente.
    const orderBy = search && search.trim().length > 0
        ? [
            sql`CASE WHEN ${kbArticles.title} ILIKE ${`%${escapeLike(search.trim())}%`} THEN 0 ELSE 1 END`,
            desc(kbArticles.updatedAt),
        ]
        : [desc(kbArticles.updatedAt)];

    const baseQuery = db.select().from(kbArticles);
    const filteredQuery = whereClause
        ? baseQuery.where(whereClause)
        : baseQuery;
    const orderedQuery = filteredQuery.orderBy(...orderBy);

    if (typeof limit === "number" && limit > 0) {
        return orderedQuery.limit(limit);
    }

    return orderedQuery;
}

/**
 * Busca artigos publicados cujo `title` ou `slug` casam com o termo via
 * `ILIKE`, retornando dados enriquecidos com a categoria (R13.8).
 *
 * Usado pela sugestão em tempo real exibida durante a digitação do
 * título de um novo ticket. Restringe-se a `published=true` porque as
 * sugestões são apresentadas a qualquer Solicitante.
 *
 * Ordenação: correspondência no título antes de slug, depois por
 * `updated_at` desc para estabilidade. O caller normalmente passa
 * `limit=5` (R13.8).
 */
export async function searchPublishedSuggestions(
    db: Database,
    query: string,
    limit: number,
): Promise<KbSuggestionRow[]> {
    const term = query.trim();
    if (term.length === 0 || limit <= 0) return [];

    const pattern = `%${escapeLike(term)}%`;
    const titleMatch = ilike(kbArticles.title, pattern);
    const slugMatch = ilike(kbArticles.slug, pattern);
    const textMatch = or(titleMatch, slugMatch);

    // Não esperamos `or` retornar `undefined` aqui porque ambos os
    // operandos são `SQL`, mas o tipo do drizzle permite `undefined`
    // em casos degenerados — guardamos o caso por segurança.
    if (!textMatch) return [];

    const rows = await db
        .select({
            id: kbArticles.id,
            slug: kbArticles.slug,
            title: kbArticles.title,
            categoryId: kbArticles.categoryId,
            categoryLabel: kbCategories.label,
            categoryIcon: kbCategories.icon,
        })
        .from(kbArticles)
        .innerJoin(kbCategories, eq(kbCategories.id, kbArticles.categoryId))
        .where(and(eq(kbArticles.published, true), textMatch))
        .orderBy(
            sql`CASE WHEN ${kbArticles.title} ILIKE ${pattern} THEN 0 ELSE 1 END`,
            desc(kbArticles.updatedAt),
        )
        .limit(limit);

    return rows;
}

/**
 * Busca um artigo pelo `slug` único. Retorna `null` quando não existe.
 *
 * Não filtra por `published`: callers (serviço/página) decidem se exibem ou
 * não rascunhos com base no papel do solicitante.
 */
export async function findBySlug(
    db: Database,
    slug: string,
): Promise<KbArticleRow | null> {
    const rows = await db
        .select()
        .from(kbArticles)
        .where(eq(kbArticles.slug, slug))
        .limit(1);
    return rows[0] ?? null;
}

/**
 * Insere um artigo na base de conhecimento.
 *
 * Conflitos de slug (constraint `kb_articles.slug` UNIQUE) são propagados
 * como exceção do driver para que o serviço os traduza em
 * `ActionResult.error.code = "CONFLICT"` (R13.5).
 */
export async function insertArticle(
    db: Database,
    values: KbArticleInsert,
): Promise<KbArticleRow> {
    const [row] = await db.insert(kbArticles).values(values).returning();
    if (!row) {
        throw new Error("insertArticle: nenhuma linha retornada após INSERT.");
    }
    return row;
}

/** Subset de colunas que podem ser modificadas via `updateArticleById`. */
export type KbArticleUpdate = Partial<{
    slug: string;
    title: string;
    body: string;
    categoryId: string;
    published: boolean;
}>;

/**
 * Atualiza campos de um artigo existente. Sempre força `updated_at = now()`
 * para manter o "atualizado em" coerente após qualquer mudança de
 * conteúdo. Conflitos de slug (UNIQUE) propagam como exceção para o
 * serviço traduzir em `CONFLICT { field: "slug" }`.
 *
 * Retorna a linha atualizada ou `null` quando o `id` não existe — o
 * serviço usa esse sinal para devolver `NOT_FOUND` sem `SELECT` extra.
 */
export async function updateArticleById(
    db: Database,
    id: string,
    values: KbArticleUpdate,
): Promise<KbArticleRow | null> {
    const rows = await db
        .update(kbArticles)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(kbArticles.id, id))
        .returning();
    return rows[0] ?? null;
}

/**
 * Remove um artigo pela chave primária.
 *
 * Retorna `true` quando uma linha foi efetivamente removida e `false`
 * para `id` inexistente (caso já apagado em outra aba/processo).
 */
export async function deleteArticleById(
    db: Database,
    id: string,
): Promise<boolean> {
    const rows = await db
        .delete(kbArticles)
        .where(eq(kbArticles.id, id))
        .returning({ id: kbArticles.id });
    return rows.length > 0;
}

/**
 * Incrementa atomicamente o contador `views` do artigo (R13.6).
 *
 * Implementado com um único `UPDATE views = views + 1`, garantindo atomicidade
 * mesmo sob alta concorrência. Quando o `id` não existe, nenhuma linha é
 * afetada — não levanta erro, pois a página já trata 404 em camada superior.
 */
export async function incrementViews(
    db: Database,
    id: string,
): Promise<void> {
    await db
        .update(kbArticles)
        .set({ views: sql`${kbArticles.views} + 1` })
        .where(eq(kbArticles.id, id));
}

/**
 * Lista todas as categorias da base de conhecimento, ordenadas por rótulo.
 */
export async function listCategories(db: Database): Promise<KbCategoryRow[]> {
    return db.select().from(kbCategories).orderBy(kbCategories.label);
}

/**
 * Escapa caracteres especiais do `LIKE`/`ILIKE` (`%` e `_`) para que termos
 * digitados pelo usuário sejam tratados literalmente.
 */
function escapeLike(input: string): string {
    return input.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}
