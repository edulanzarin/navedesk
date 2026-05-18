/**
 * Server Actions da Base de Conhecimento (KB) do NaveDesk.
 *
 * Camada fina entre os formulários de `/kb/*` e o serviço
 * `kb.service`. Cada action segue o pipeline padrão das Server
 * Actions do projeto:
 *
 * 1. Recupera a sessão via `auth()`. Sem sessão → `UNAUTHORIZED`
 *    (defesa em profundidade sobre o middleware: Server Actions são
 *    endpoints públicos do ponto de vista de segurança).
 * 2. Para entradas vindas do cliente, valida o payload bruto
 *    (`unknown`) com Zod antes de delegar ao serviço — mesmo que o
 *    serviço também revalide, o parse na borda devolve `field` para
 *    `react-hook-form` casar a mensagem com o campo certo.
 * 3. Delega RBAC + persistência ao serviço, que devolve um
 *    `ActionResult<T>` pronto.
 * 4. Em sucesso, dispara `revalidatePath` na rota afetada para que a
 *    próxima navegação reflita o novo estado sem reload manual.
 *
 * `publishArticleAction` usa um `UPDATE` direto sobre `kb_articles`
 * (encapsulado por uma função local) por se tratar de uma transição
 * de estado pontual que ainda não justifica um helper dedicado em
 * `kb.service`. A regra de papel é a mesma da criação
 * (`canCreateKbArticle`): técnicos e admins publicam, solicitantes
 * não.
 *
 * `incrementViewsAction` é fire-and-forget: não exige autenticação
 * (artigos publicados são públicos a qualquer papel autenticado e a
 * página já cuida de carregar o artigo via service); apenas roda o
 * `UPDATE views = views + 1` no repositório.
 *
 * Validates: R13.
 */

"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

import { auth } from "@/lib/auth";
import { db } from "@/db/client";
import { kbArticles } from "@/db/schema";
import {
    findBySlug,
    incrementViews,
    type KbArticleRow,
} from "@/db/repositories/kb.repo";
import { CreateKbArticleSchema, KbSuggestQuerySchema, UpdateKbArticleSchema } from "@/lib/schemas";
import { canCreateKbArticle } from "@/lib/policies";
import {
    createArticle as svcCreateArticle,
    deleteArticle as svcDeleteArticle,
    searchPublishedArticles,
    updateArticle as svcUpdateArticle,
    type KbArticleSuggestion,
} from "@/services/kb.service";
import type { ActionResult, SessionUser } from "@/types/domain";

/**
 * `ActionResult` compartilhado para sessão ausente. Mantemos a forma
 * em uma helper para que os pontos de entrada permaneçam concisos e
 * que a string de erro fique padronizada com as demais actions.
 */
function unauthorized(): ActionResult<never> {
    return {
        ok: false,
        error: {
            code: "UNAUTHORIZED",
            message: "Sessão inválida.",
        },
    };
}

/**
 * Cria um novo artigo da Base de Conhecimento (R13.4, R13.5, R13.9).
 *
 * Pipeline:
 *
 * 1. Exige sessão (`UNAUTHORIZED` quando ausente).
 * 2. Faz `safeParse` com `CreateKbArticleSchema` para devolver erros
 *    amarrados a `field` antes mesmo de tocar o serviço — útil para
 *    o formulário de `/kb/novo` exibir mensagens contextuais.
 * 3. Delega ao serviço, que aplica `canCreateKbArticle`, persiste e
 *    converte conflito de slug (SQLSTATE `23505`) em
 *    `CONFLICT { field: "slug" }`.
 * 4. Em sucesso, revalida `/kb` para que a listagem reflita o novo
 *    artigo.
 */
export async function createArticleAction(
    rawInput: unknown,
): Promise<ActionResult<KbArticleRow>> {
    const session = await auth();
    if (!session?.user) return unauthorized();

    const parsed = CreateKbArticleSchema.safeParse(rawInput);
    if (!parsed.success) {
        const issue = parsed.error.issues[0];
        return {
            ok: false,
            error: {
                code: "VALIDATION_ERROR",
                message: issue?.message ?? "Dados inválidos.",
                ...(issue?.path.length ? { field: issue.path.join(".") } : {}),
            },
        };
    }

    const result = await svcCreateArticle(
        session.user as SessionUser,
        parsed.data,
    );
    if (result.ok) {
        revalidatePath("/kb");
    }
    return result;
}

/**
 * Publica um artigo previamente criado como rascunho (R13.4).
 *
 * Mesma policy da criação: somente `tecnico`/`admin` (R13.9 nega
 * solicitantes). Quando o slug não existe, devolve `NOT_FOUND`. Se
 * já estava publicado, é idempotente — retorna a linha atual sem
 * tocar `updated_at` para não inflar histórico.
 *
 * O `UPDATE` roda em uma única instrução com `RETURNING *` para
 * evitar um round-trip extra de SELECT após a escrita.
 */
export async function publishArticleAction(
    slug: string,
): Promise<ActionResult<KbArticleRow>> {
    const session = await auth();
    if (!session?.user) return unauthorized();

    const actor = session.user as SessionUser;
    if (!canCreateKbArticle(actor)) {
        return {
            ok: false,
            error: {
                code: "FORBIDDEN",
                message: "Você não pode publicar artigos da base de conhecimento.",
            },
        };
    }

    const article = await findBySlug(db, slug);
    if (!article) {
        return {
            ok: false,
            error: {
                code: "NOT_FOUND",
                message: "Artigo não encontrado.",
            },
        };
    }

    if (article.published) {
        return { ok: true, data: article };
    }

    const [updated] = await db
        .update(kbArticles)
        .set({ published: true, updatedAt: new Date() })
        .where(eq(kbArticles.slug, slug))
        .returning();

    if (!updated) {
        // Linha sumiu entre o SELECT e o UPDATE (corrida com exclusão
        // manual via SQL): tratamos como não-encontrado para o caller.
        return {
            ok: false,
            error: {
                code: "NOT_FOUND",
                message: "Artigo não encontrado.",
            },
        };
    }

    revalidatePath("/kb");
    revalidatePath(`/kb/${slug}`);
    return { ok: true, data: updated };
}

/**
 * Incrementa atomicamente o contador `views` do artigo (R13.6).
 *
 * Pensada para ser disparada pela página de leitura como
 * fire-and-forget. Não exige sessão porque o acesso ao artigo já
 * passou pela autenticação no Server Component que renderiza a
 * página, e o repositório usa `UPDATE views = views + 1` — atômico
 * mesmo sob concorrência.
 */
export async function incrementViewsAction(id: string): Promise<void> {
    await incrementViews(db, id);
}

/**
 * Atualiza um artigo existente (R13).
 *
 * Pipeline:
 *
 * 1. Exige sessão (`UNAUTHORIZED`).
 * 2. Faz `safeParse` com `UpdateKbArticleSchema` para devolver erros
 *    amarrados a `field` antes do serviço.
 * 3. Delega ao `kb.service.updateArticle`, que aplica
 *    `canEditKbArticle` (admin sempre, técnico só nos próprios) e
 *    converte conflito de slug em `CONFLICT { field: "slug" }`.
 * 4. Em sucesso revalida `/kb` (lista) e os dois slugs envolvidos —
 *    o anterior (caso o slug tenha mudado) e o novo, garantindo
 *    que ambas as URLs reflitam o estado correto.
 */
export async function updateArticleAction(
    slug: string,
    rawInput: unknown,
): Promise<ActionResult<KbArticleRow>> {
    const session = await auth();
    if (!session?.user) return unauthorized();

    const parsed = UpdateKbArticleSchema.safeParse(rawInput);
    if (!parsed.success) {
        const issue = parsed.error.issues[0];
        return {
            ok: false,
            error: {
                code: "VALIDATION_ERROR",
                message: issue?.message ?? "Dados inválidos.",
                ...(issue?.path.length ? { field: issue.path.join(".") } : {}),
            },
        };
    }

    const result = await svcUpdateArticle(
        session.user as SessionUser,
        slug,
        parsed.data,
    );
    if (result.ok) {
        revalidatePath("/kb");
        revalidatePath(`/kb/${slug}`);
        // Caso o autor tenha alterado o slug, revalida também a URL nova.
        if (result.data.slug !== slug) {
            revalidatePath(`/kb/${result.data.slug}`);
        }
    }
    return result;
}

/**
 * Exclui um artigo da Base de Conhecimento.
 *
 * Após a exclusão, revalida `/kb` para atualizar a listagem. A página
 * `/kb/{slug}` daquele artigo passa a responder 404 naturalmente
 * (o `findBySlug` devolve `null`), então não precisa de revalidação
 * dedicada.
 */
export async function deleteArticleAction(
    slug: string,
): Promise<ActionResult<void>> {
    const session = await auth();
    if (!session?.user) return unauthorized();

    const result = await svcDeleteArticle(session.user as SessionUser, slug);
    if (result.ok) {
        revalidatePath("/kb");
    }
    return result;
}

/**
 * Sugere até 5 artigos publicados relevantes para o `query` informado,
 * usado pela tela `/tickets/novo` ao digitar o título do chamado
 * (R13.8 — deflexão).
 *
 * Pipeline:
 *
 * 1. Exige sessão (`UNAUTHORIZED` quando ausente). Sugestões só fazem
 *    sentido em formulários autenticados; manter a checagem aqui evita
 *    expor o endpoint a clientes anônimos.
 * 2. Valida o payload com `KbSuggestQuerySchema` — termos abaixo de 3
 *    caracteres ou acima de 100 são rejeitados antes de tocar o banco.
 *    Em vez de devolver erro para a UI, normalizamos o caso de termo
 *    insuficiente como sucesso com lista vazia: o componente
 *    consumidor pode digitar livremente sem precisar de tratamento
 *    especial para mensagens de validação.
 * 3. Delega ao serviço, que faz `JOIN` com `kb_categories` e devolve
 *    o shape achatado `KbArticleSuggestion` pronto para renderização.
 *
 * Retorna sempre o mesmo `ActionResult<KbArticleSuggestion[]>` para
 * uniformidade com as demais actions, mesmo que o erro mais comum
 * possível seja `UNAUTHORIZED`.
 */
export async function suggestKbArticlesAction(
    rawInput: unknown,
): Promise<ActionResult<KbArticleSuggestion[]>> {
    const session = await auth();
    if (!session?.user) return unauthorized();

    const parsed = KbSuggestQuerySchema.safeParse(rawInput);
    if (!parsed.success) {
        // Termo muito curto ou inválido: comportamento amigável é
        // devolver lista vazia em vez de propagar erro para a UI, que
        // dispara a action a cada keystroke.
        return { ok: true, data: [] };
    }

    const suggestions = await searchPublishedArticles(parsed.data.query, 5);
    return { ok: true, data: suggestions };
}
