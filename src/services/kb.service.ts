/**
 * KB service — orquestra a Base de Conhecimento (R13).
 *
 * Esta camada concentra as regras de visibilidade, autorização e
 * persistência sobre `kb_articles` e `kb_categories`. Mantém o repositório
 * livre de RBAC e expõe um contrato estável (`ActionResult`) para Server
 * Actions e Server Components consumirem sem se preocupar com detalhes do
 * driver.
 *
 * Pontos-chave:
 *
 * - **Visibilidade (R13.1, R13.2)**: artigos publicados são visíveis a todos
 *   os papéis. Tecnico/Admin também enxergam seus próprios rascunhos. O
 *   filtro é aplicado no SQL via `kb.repo.listArticles({ publishedOnly,
 *   authorId })`.
 * - **Busca textual (R13.3)**: `searchArticles` e o `search` em
 *   `listArticles` chegam ao repositório, que ordena por relevância
 *   aproximada (título antes de corpo).
 * - **Criação com slug único (R13.4, R13.5)**: violação da constraint
 *   `kb_articles.slug UNIQUE` é capturada e traduzida em `CONFLICT` antes
 *   de propagar como exceção. Demais erros do driver fluem para cima.
 * - **Incremento atômico de views (R13.6)**: `getArticleBySlug` corre
 *   `findBySlug` + `incrementViews` numa única transação para garantir
 *   leitura/escrita consistentes mesmo sob concorrência.
 * - **Sugestões (R13.8)**: `suggestForTitle` reusa o `listArticles` do
 *   repositório com `publishedOnly=true` e `limit=5`. Não exige autenticação
 *   específica porque é consumido durante a abertura de tickets.
 * - **Renderização (R13.7)**: a sanitização do markdown (`react-markdown` +
 *   `rehype-sanitize`) ocorre na camada de UI quando os componentes
 *   renderizam o `body`; a service apenas devolve o markdown bruto.
 *
 * Validates: R13.
 */

import { db } from "@/db/client";
import {
    deleteArticleById,
    findBySlug,
    incrementViews,
    insertArticle,
    listArticles as repoListArticles,
    listCategories as repoListCategories,
    searchPublishedSuggestions,
    updateArticleById,
    type KbArticleRow,
    type KbCategoryRow,
    type KbSuggestionRow,
} from "@/db/repositories/kb.repo";
import {
    canCreateKbArticle,
    canDeleteKbArticle,
    canEditKbArticle,
} from "@/lib/policies";
import {
    CreateKbArticleSchema,
    UpdateKbArticleSchema,
    type CreateKbArticleInput,
    type UpdateKbArticleInput,
} from "@/lib/schemas";
import type { ActionResult, SessionUser } from "@/types/domain";

/**
 * Opções de listagem expostas pela camada de serviço.
 *
 * Repassadas ao repositório, com a regra de visibilidade
 * (publicados + rascunhos do autor) já aplicada implicitamente para
 * `tecnico`/`admin` em `listArticlesForUser` e `searchArticles`.
 */
export interface ListArticlesServiceOptions {
    categoryId?: string;
    search?: string;
    limit?: number;
}

/**
 * Lista artigos visíveis para o usuário aplicando R13.1 e R13.2.
 *
 * - `solicitante`: enxerga apenas artigos publicados.
 * - `tecnico` / `admin`: enxergam publicados **ou** rascunhos próprios.
 *
 * O filtro de autoria é aplicado no SQL via `authorId` quando o papel
 * permite ver rascunhos, garantindo que rascunhos de outros autores
 * permaneçam invisíveis ainda que `published=false`.
 */
export async function listArticlesForUser(
    user: SessionUser,
    opts: ListArticlesServiceOptions = {},
): Promise<KbArticleRow[]> {
    const canSeeOwnDrafts = user.role === "tecnico" || user.role === "admin";
    return repoListArticles(db, {
        publishedOnly: true,
        authorId: canSeeOwnDrafts ? user.id : undefined,
        categoryId: opts.categoryId,
        search: opts.search,
        limit: opts.limit,
    });
}

/**
 * Busca textual sobre título e corpo, ordenada por relevância (R13.3).
 *
 * Compartilha as mesmas regras de visibilidade de `listArticlesForUser`:
 * solicitantes só recebem publicados; tecnico/admin recebem também os
 * próprios rascunhos.
 */
export async function searchArticles(
    user: SessionUser,
    query: string,
    opts: { categoryId?: string; limit?: number } = {},
): Promise<KbArticleRow[]> {
    return listArticlesForUser(user, {
        search: query,
        categoryId: opts.categoryId,
        limit: opts.limit,
    });
}

/**
 * Recupera um artigo pelo `slug` e, quando publicado, incrementa
 * atomicamente o contador de visualizações (R13.6).
 *
 * Regras de visibilidade:
 *
 * - Artigo publicado: visível a qualquer papel.
 * - Rascunho (`published=false`): visível somente ao próprio autor
 *   quando o papel é `tecnico` ou `admin` (R13.2). Em outros casos,
 *   responde como se o artigo não existisse para evitar enumeração de
 *   slugs em rascunho.
 *
 * O incremento de views só ocorre para artigos publicados — rascunhos
 * exibidos ao autor não inflam métricas. Tudo dentro de uma única
 * transação para que o registro retornado reflita o estado pós-update.
 *
 * Retornos:
 *
 * - `{ ok: true, data: row }` com `views` já atualizado quando aplicável.
 * - `{ ok: false, error.code: "NOT_FOUND" }` quando o slug não existe ou
 *   o solicitante não pode enxergá-lo.
 */
export async function getArticleBySlug(
    user: SessionUser,
    slug: string,
): Promise<ActionResult<KbArticleRow>> {
    const result = await db.transaction(async (tx) => {
        const executor = tx as unknown as typeof db;
        const article = await findBySlug(executor, slug);
        if (!article) return null;

        if (!article.published) {
            const isAuthor = article.authorId === user.id;
            const canSeeDrafts =
                user.role === "tecnico" || user.role === "admin";
            if (!isAuthor || !canSeeDrafts) {
                return null;
            }
            // Rascunho do próprio autor: devolve sem mexer em `views`.
            return article;
        }

        await incrementViews(executor, article.id);
        // Reflete o incremento no payload retornado sem refazer SELECT —
        // a transação garante que nenhum outro writer entrou no meio.
        return { ...article, views: article.views + 1 };
    });

    if (!result) {
        return {
            ok: false,
            error: {
                code: "NOT_FOUND",
                message: "Artigo não encontrado.",
            },
        };
    }

    return { ok: true, data: result };
}

/**
 * Cria um novo artigo da Base de Conhecimento (R13.4, R13.5, R13.9).
 *
 * 1. Reaplica `CreateKbArticleSchema` por defesa em profundidade — Server
 *    Actions já validam, mas o serviço também é chamado por testes/scripts.
 * 2. Valida `canCreateKbArticle(actor)`. Solicitantes recebem `FORBIDDEN`
 *    (R13.9), espelhando o comportamento do middleware.
 * 3. Insere em transação preenchendo `authorId` com o ator. Conflito de
 *    slug (constraint UNIQUE → SQLSTATE `23505`) é capturado e devolvido
 *    como `CONFLICT`, com `field: "slug"` para amarrar ao formulário.
 *
 * Outras falhas do driver (FK inválida, perda de conexão) propagam como
 * exceção para serem mapeadas em HTTP 500 pelo caller.
 */
export async function createArticle(
    actor: SessionUser,
    rawInput: CreateKbArticleInput,
): Promise<ActionResult<KbArticleRow>> {
    const parsed = CreateKbArticleSchema.safeParse(rawInput);
    if (!parsed.success) {
        const issue = parsed.error.issues[0];
        return {
            ok: false,
            error: {
                code: "VALIDATION_ERROR",
                message: issue?.message ?? "Dados inválidos.",
                field: issue?.path.join(".") || undefined,
            },
        };
    }

    if (!canCreateKbArticle(actor)) {
        return {
            ok: false,
            error: {
                code: "FORBIDDEN",
                message: "Você não pode criar artigos da base de conhecimento.",
            },
        };
    }

    const input = parsed.data;

    try {
        const row = await db.transaction(async (tx) => {
            const executor = tx as unknown as typeof db;
            return insertArticle(executor, {
                slug: input.slug,
                title: input.title,
                body: input.body,
                categoryId: input.categoryId,
                authorId: actor.id,
                published: input.published,
            });
        });
        return { ok: true, data: row };
    } catch (err) {
        if (isUniqueViolation(err)) {
            return {
                ok: false,
                error: {
                    code: "CONFLICT",
                    message: "Já existe um artigo com esse slug.",
                    field: "slug",
                },
            };
        }
        throw err;
    }
}

/**
 * Atualiza um artigo existente identificado por `slug`.
 *
 * Pipeline:
 *
 * 1. Valida `rawInput` com `UpdateKbArticleSchema` (mesmas restrições
 *    da criação). Falha → `VALIDATION_ERROR` com `field`.
 * 2. Carrega o artigo atual via `findBySlug` para checar
 *    `canEditKbArticle(actor, article)`. Solicitantes e técnicos que
 *    não escreveram o artigo recebem `FORBIDDEN`.
 * 3. Faz `UPDATE ... RETURNING` em transação. Conflito de UNIQUE
 *    (slug duplicado) é traduzido em `CONFLICT { field: "slug" }`.
 *
 * `authorId` não é tocado: a auditoria do redator original é
 * preservada mesmo quando um admin edita o artigo (R13).
 */
export async function updateArticle(
    actor: SessionUser,
    slug: string,
    rawInput: UpdateKbArticleInput,
): Promise<ActionResult<KbArticleRow>> {
    const parsed = UpdateKbArticleSchema.safeParse(rawInput);
    if (!parsed.success) {
        const issue = parsed.error.issues[0];
        return {
            ok: false,
            error: {
                code: "VALIDATION_ERROR",
                message: issue?.message ?? "Dados inválidos.",
                field: issue?.path.join(".") || undefined,
            },
        };
    }

    const existing = await findBySlug(db, slug);
    if (!existing) {
        return {
            ok: false,
            error: {
                code: "NOT_FOUND",
                message: "Artigo não encontrado.",
            },
        };
    }

    if (!canEditKbArticle(actor, existing)) {
        return {
            ok: false,
            error: {
                code: "FORBIDDEN",
                message: "Você não pode editar este artigo.",
            },
        };
    }

    const input = parsed.data;
    try {
        const row = await db.transaction(async (tx) => {
            const executor = tx as unknown as typeof db;
            return updateArticleById(executor, existing.id, {
                slug: input.slug,
                title: input.title,
                body: input.body,
                categoryId: input.categoryId,
                published: input.published,
            });
        });

        if (!row) {
            // Linha sumiu entre o SELECT e o UPDATE — corrida com
            // exclusão manual; tratamos como NOT_FOUND.
            return {
                ok: false,
                error: {
                    code: "NOT_FOUND",
                    message: "Artigo não encontrado.",
                },
            };
        }

        return { ok: true, data: row };
    } catch (err) {
        if (isUniqueViolation(err)) {
            return {
                ok: false,
                error: {
                    code: "CONFLICT",
                    message: "Já existe um artigo com esse slug.",
                    field: "slug",
                },
            };
        }
        throw err;
    }
}

/**
 * Exclui um artigo da Base de Conhecimento.
 *
 * Pipeline:
 *
 * 1. Carrega o artigo via `findBySlug`. Inexistente → `NOT_FOUND`.
 * 2. Aplica `canDeleteKbArticle` (admin sempre, técnico só nos
 *    próprios). Falha → `FORBIDDEN`.
 * 3. `DELETE` por `id`. Devolve sucesso vazio (`data: undefined`)
 *    para que a Server Action revalide listagens.
 *
 * Não há reversão: a operação é destrutiva. Para rascunhos, o
 * caminho preferencial é manter `published=false` em vez de excluir.
 */
export async function deleteArticle(
    actor: SessionUser,
    slug: string,
): Promise<ActionResult<void>> {
    const existing = await findBySlug(db, slug);
    if (!existing) {
        return {
            ok: false,
            error: {
                code: "NOT_FOUND",
                message: "Artigo não encontrado.",
            },
        };
    }

    if (!canDeleteKbArticle(actor, existing)) {
        return {
            ok: false,
            error: {
                code: "FORBIDDEN",
                message: "Você não pode excluir este artigo.",
            },
        };
    }

    const removed = await deleteArticleById(db, existing.id);
    if (!removed) {
        return {
            ok: false,
            error: {
                code: "NOT_FOUND",
                message: "Artigo não encontrado.",
            },
        };
    }

    return { ok: true, data: undefined };
}

/**
 * Sugere até `limit` artigos publicados relevantes para o texto informado
 * (R13.8). Usado pela tela de criação de tickets ao digitar o título.
 *
 * `text` em branco resulta em lista vazia para evitar custo desnecessário
 * de varredura completa. Sempre considera apenas artigos publicados,
 * independentemente do papel do usuário, porque sugestões nascem em
 * formulários públicos a qualquer Solicitante.
 */
export async function suggestForTitle(
    text: string,
    limit = 5,
): Promise<KbArticleRow[]> {
    const term = text.trim();
    if (term.length === 0) return [];

    return repoListArticles(db, {
        publishedOnly: true,
        search: term,
        limit,
    });
}

/**
 * Tipo serializável retornado por `searchPublishedArticles`.
 *
 * Fica achatado de propósito: tudo que a UI de sugestão precisa para
 * renderizar um item (título, link, ícone e rótulo da categoria) sem
 * round-trips adicionais. Atravessa Server Action → Client Component
 * sem perder forma.
 */
export interface KbArticleSuggestion {
    id: string;
    slug: string;
    title: string;
    categoryLabel: string;
    categoryIcon: string;
}

/**
 * Busca artigos publicados cujo título ou slug casam com `query` (R13.8).
 *
 * Implementação preferida para a sugestão em tempo real durante a
 * digitação do título de um novo ticket. Diferença para
 * `suggestForTitle`:
 *
 * - Consulta apenas `title` e `slug` (não o corpo), reduzindo o custo
 *   de I/O por keystroke.
 * - Faz `JOIN` com `kb_categories` no SQL para devolver `categoryLabel`
 *   e `categoryIcon` num único round-trip.
 * - Limpa o termo via `trim` e devolve lista vazia para entradas mais
 *   curtas que `minLength` (default 3 — alinhado a `KbSuggestQuerySchema`).
 *
 * Sempre restringe a artigos publicados (`published=true`) — sugestões
 * são exibidas a qualquer Solicitante, então rascunhos devem ficar
 * fora.
 */
export async function searchPublishedArticles(
    query: string,
    limit = 5,
    minLength = 3,
): Promise<KbArticleSuggestion[]> {
    const term = query.trim();
    if (term.length < minLength) return [];

    const rows = await searchPublishedSuggestions(db, term, limit);
    return rows.map(toSuggestion);
}

/**
 * Adapta uma `KbSuggestionRow` ao shape estável `KbArticleSuggestion`.
 *
 * Centraliza o mapeamento para evitar duplicação caso novas chamadas
 * passem a expor sugestões.
 */
function toSuggestion(row: KbSuggestionRow): KbArticleSuggestion {
    return {
        id: row.id,
        slug: row.slug,
        title: row.title,
        categoryLabel: row.categoryLabel,
        categoryIcon: row.categoryIcon,
    };
}

/**
 * Lista as categorias disponíveis para classificar artigos.
 *
 * Reusa o repositório sem filtros adicionais — não há regra de visibilidade
 * por papel para categorias.
 */
export async function listCategories(): Promise<KbCategoryRow[]> {
    return repoListCategories(db);
}

/**
 * Detecta violação de UNIQUE do PostgreSQL (`SQLSTATE 23505`).
 *
 * O `node-postgres` propaga o erro com a propriedade `code` igual ao
 * SQLSTATE; o Drizzle não embrulha a exceção, então o `instanceof Error`
 * basta para o type narrowing seguro sem importar `pg.DatabaseError`
 * (evita acoplamento direto ao pacote no serviço).
 */
function isUniqueViolation(err: unknown): boolean {
    if (!(err instanceof Error)) return false;
    const code = (err as Error & { code?: unknown }).code;
    return typeof code === "string" && code === "23505";
}
