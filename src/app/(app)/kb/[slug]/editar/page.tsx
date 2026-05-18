/**
 * Página `/kb/[slug]/editar` (Server Component).
 *
 * Reaproveita o `NewKbArticleForm` em modo de edição. Responsável por:
 *
 * 1. Defesa em profundidade da sessão via `auth()` + `redirect("/login")`
 *    (R1.1, R1.7) — o middleware já bloqueia anônimos, mas mantemos o
 *    guard explícito como em todas as páginas do grupo `(app)`.
 * 2. RBAC: somente o autor (técnico) ou um admin podem editar (R13.9).
 *    Nesse cenário o `kb.service.canEditKbArticle` é a fonte da
 *    verdade; aqui usamos o predicado para decidir se renderizamos o
 *    formulário ou redirecionamos.
 * 3. Visibilidade: o autor pode ver o próprio rascunho mesmo que
 *    `published=false`. Para isso usamos `findBySlug` direto, sem o
 *    incremento de views feito por `getArticleBySlug` — a página de
 *    edição não conta como visualização real.
 * 4. Carrega categorias da KB e injeta no formulário; o `Server
 *    Action` `updateArticleAction` é chamado pelo cliente em sucesso
 *    (`router.push("/kb/{novoSlug}")`).
 *
 * Slug indisponível ou usuário sem permissão → `notFound()` (R12.7),
 * sem distinguir os dois casos para evitar enumeração.
 *
 * Validates: R13.
 */

import { notFound, redirect } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { db } from "@/db/client";
import { findBySlug } from "@/db/repositories/kb.repo";
import { auth } from "@/lib/auth";
import { canEditKbArticle } from "@/lib/policies";
import { listCategories as listKbCategories } from "@/services/kb.service";
import type { SessionUser } from "@/types/domain";

import { NewKbArticleForm } from "../../novo/new-kb-article-form";

interface KbEditPageProps {
    params: Promise<{ slug: string }>;
}

export default async function KbEditArticlePage({ params }: KbEditPageProps) {
    const session = await auth();
    if (!session?.user) {
        redirect("/login");
    }
    const user = session.user satisfies SessionUser;

    const { slug: rawSlug } = await params;
    const slug = decodeURIComponent(rawSlug);
    if (slug.length === 0) {
        notFound();
    }

    // Carrega o artigo direto pelo repositório (não usar
    // `getArticleBySlug` que incrementa views). Inexistente OU sem
    // permissão → `notFound`, indistinguíveis para não revelar
    // existência (R12.7).
    const article = await findBySlug(db, slug);
    if (!article || !canEditKbArticle(user, article)) {
        notFound();
    }

    const categories = await listKbCategories();

    return (
        <div>
            <PageHeader
                title="Editar artigo"
                description={`“${article.title}”`}
            />
            <NewKbArticleForm
                categories={categories}
                originalSlug={article.slug}
                initialValues={{
                    slug: article.slug,
                    title: article.title,
                    body: article.body,
                    categoryId: article.categoryId,
                    published: article.published,
                }}
            />
        </div>
    );
}
