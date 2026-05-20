/**
 * Página `/kb/[slug]` (Server Component).
 *
 * Detalhe de um artigo da Base de Conhecimento. Assume que o
 * middleware já bloqueia anônimos, mas reaplica `auth()` +
 * `redirect("/login")` como defesa em profundidade — o mesmo padrão
 * adotado em `/tickets/[id]` e `/kb` (R1.1, R1.7).
 *
 * O carregamento do artigo é delegado a `kb.service.getArticleBySlug`,
 * que concentra três responsabilidades em uma única transação:
 *
 * 1. **Incremento atômico de views (R13.6)**: `UPDATE views = views + 1`
 *    para artigos publicados, dentro da mesma transação do `SELECT`,
 *    garantindo que cada visualização seja contabilizada exatamente
 *    uma vez mesmo sob concorrência.
 * 2. **Visibilidade por papel (R13.1, R13.2)**: artigos publicados
 *    são acessíveis a qualquer papel autenticado; rascunhos
 *    (`published=false`) só aparecem para o próprio autor quando
 *    `tecnico`/`admin`. Em qualquer outro caso o serviço devolve
 *    `NOT_FOUND` — igualando "não existe" e "não pode ver" para não
 *    revelar a existência de slugs em rascunho.
 * 3. **Carga única**: a transação devolve a linha já com `views`
 *    atualizado, evitando um SELECT extra após o UPDATE.
 *
 * O conteúdo do artigo (`body`) é markdown bruto. Renderizamos com
 * `react-markdown` + `rehype-sanitize` na camada de UI (R13.7), que
 * neutraliza scripts, atributos `on*` e `javascript:` URIs antes do
 * HTML chegar ao DOM.
 *
 * Notas de implementação:
 *
 * - `params` em Next 15 chega como `Promise` e exige `await` antes do
 *   uso (mesmo padrão de `(app)/tickets/[id]/page.tsx`).
 * - `decodeURIComponent` no slug porque, embora os slugs gerados pelo
 *   sistema sejam ASCII puro, qualquer cliente pode fazer percent-encode.
 * - Carregamentos auxiliares (`categories`, `author`) rodam em paralelo
 *   ao incremento de views via `Promise.all` para reduzir TTFB.
 * - Componente puro RSC — sem `"use client"`, sem hooks. O `react-markdown`
 *   funciona nativamente em RSC (não tem lifecycle de cliente).
 *
 * Validates: R13.6, R13.7
 */

import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ArrowLeft, Eye, Pencil } from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";

import { CategoryChip } from "@/components/domain/category-chip";
import { PageHeader } from "@/components/layout/page-header";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { db } from "@/db/client";
import { findById as findUserById } from "@/db/repositories/users.repo";
import { auth } from "@/lib/auth";
import { fmtDateTime, relTime } from "@/lib/format";
import { canDeleteKbArticle, canEditKbArticle } from "@/lib/policies";
import {
    getArticleBySlug,
    listCategories as listKbCategories,
} from "@/services/kb.service";
import type { SessionUser } from "@/types/domain";

import { DeleteArticleButton } from "./delete-article-button";

/**
 * Schema de sanitização estendido para suportar vídeos inline. O
 * editor da KB injeta `<video controls src="…">` quando o autor
 * adiciona um vídeo via toolbar; o `defaultSchema` do
 * `rehype-sanitize` derruba a tag inteira porque ela não está na
 * allowlist padrão. Aqui adicionamos `video` e `source` à allowlist e
 * habilitamos os atributos mínimos para reprodução nativa
 * (`src`, `controls`, `width`, `height`, `poster`, `preload`,
 * `muted`, `playsinline`). Mantemos o restante do schema intacto —
 * nada de scripts, handlers `on*` ou URIs `javascript:` passa.
 */
const SANITIZE_SCHEMA = {
    ...defaultSchema,
    tagNames: [...(defaultSchema.tagNames ?? []), "video", "source"],
    attributes: {
        ...defaultSchema.attributes,
        video: [
            ["controls"],
            ["src"],
            ["width"],
            ["height"],
            ["poster"],
            ["preload"],
            ["muted"],
            ["playsinline"],
        ],
        source: [
            ["src"],
            ["type"],
        ],
    },
};

/** Em Next 15 `params` é uma Promise — precisa ser `await`-ado. */
interface KbArticlePageProps {
    params: Promise<{ slug: string }>;
}

export default async function KbArticlePage({ params }: KbArticlePageProps) {
    // Defesa em profundidade — middleware já bloqueia anônimos, mas o
    // redirect explícito garante que nenhum bloco abaixo execute sem
    // `session.user` populado (R1.1, R1.7).
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

    // 1) Carrega o artigo aplicando visibilidade por papel e
    //    incrementando `views` atomicamente quando publicado (R13.6).
    //    `getArticleBySlug` devolve `NOT_FOUND` tanto para slug
    //    inexistente quanto para rascunho que o solicitante não pode
    //    ver — o `notFound()` aqui cobre os dois casos sem revelar
    //    existência (R12.7-style: 404 sem distinção).
    const result = await getArticleBySlug(user, slug);
    if (!result.ok) {
        notFound();
    }
    const article = result.data;

    // 2) Carregamentos auxiliares em paralelo: categorias para resolver
    //    rótulo/ícone e o autor para o bloco de meta. Nenhum bloqueia
    //    o outro depois que o artigo está em mãos.
    const [categories, author] = await Promise.all([
        listKbCategories(),
        findUserById(db, article.authorId),
    ]);

    const category = categories.find((c) => c.id === article.categoryId);
    const categoryIcon = category?.icon ?? "tag";
    const categoryLabel = category?.label ?? article.categoryId;
    const authorName = author?.name ?? "Autor desconhecido";

    // Permissões para edição/exclusão. Admin sempre, técnico só nos
    // próprios. Calculadas no servidor para que a UI seja coerente
    // com a Server Action que valida de novo (R13).
    const canEdit = canEditKbArticle(user, article);
    const canDelete = canDeleteKbArticle(user, article);

    return (
        <div>
            <PageHeader
                title={article.title}
                description={
                    author
                        ? `Por ${author.name} · atualizado ${relTime(article.updatedAt)}`
                        : `Atualizado ${relTime(article.updatedAt)}`
                }
                actions={
                    <div className="flex flex-wrap items-center gap-2">
                        <Button variant="ghost" asChild icon={<ArrowLeft />}>
                            <Link href="/kb">Voltar</Link>
                        </Button>
                        {canEdit ? (
                            <Button
                                variant="default"
                                asChild
                                icon={<Pencil />}
                            >
                                <Link href={`/kb/${article.slug}/editar`}>
                                    Editar
                                </Link>
                            </Button>
                        ) : null}
                        {canDelete ? (
                            <DeleteArticleButton
                                slug={article.slug}
                                title={article.title}
                            />
                        ) : null}
                    </div>
                }
            />

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_16rem]">
                {/* Coluna principal — corpo do artigo. */}
                <article aria-label="Conteúdo do artigo">
                    <Card>
                        <CardContent className="p-6 md:p-8">
                            {/*
                              `react-markdown` renderiza o markdown bruto
                              em uma árvore React; `rehype-sanitize` aplica
                              uma allowlist por padrão, removendo
                              `<script>`, atributos `on*` e URIs
                              `javascript:` antes do HTML ser emitido
                              (R13.7). `remark-gfm` habilita tabelas,
                              listas de tarefas e strikethrough — comuns
                              em artigos técnicos.

                              Tipografia: classes Tailwind aplicadas via
                              wrappers usariam o plugin `@tailwindcss/typography`,
                              que ainda não está no projeto. Como a estética
                              do KB é mais funcional do que editorial,
                              usamos um conjunto enxuto de regras
                              `[&_…]:` direto no container para cobrir
                              títulos, parágrafos, listas, citações,
                              código e tabelas sem dependência extra.
                            */}
                            <div
                                className={
                                    // Estilos base do conteúdo markdown.
                                    "max-w-none text-sm text-(--ink-2) leading-7 " +
                                    // Cabeçalhos
                                    "[&_h1]:mt-8 [&_h1]:mb-4 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:text-(--ink) " +
                                    "[&_h2]:mt-7 [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-(--ink) " +
                                    "[&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-(--ink) " +
                                    "[&_h4]:mt-5 [&_h4]:mb-2 [&_h4]:text-base [&_h4]:font-semibold [&_h4]:text-(--ink) " +
                                    "[&_h1:first-child]:mt-0 [&_h2:first-child]:mt-0 [&_h3:first-child]:mt-0 " +
                                    // Parágrafos e ênfases
                                    "[&_p]:my-4 [&_strong]:font-semibold [&_strong]:text-(--ink) " +
                                    // Links
                                    "[&_a]:text-(--accent) [&_a]:underline [&_a]:underline-offset-2 hover:[&_a]:opacity-80 " +
                                    // Listas
                                    "[&_ul]:my-4 [&_ul]:list-disc [&_ul]:pl-6 " +
                                    "[&_ol]:my-4 [&_ol]:list-decimal [&_ol]:pl-6 " +
                                    "[&_li]:my-1 " +
                                    // Citações
                                    "[&_blockquote]:my-4 [&_blockquote]:border-l-4 [&_blockquote]:border-(--line) [&_blockquote]:pl-4 [&_blockquote]:text-(--ink-3) [&_blockquote]:italic " +
                                    // Código inline e bloco
                                    "[&_code]:rounded-(--r-2) [&_code]:bg-(--bg-sunk) [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.875em] " +
                                    "[&_pre]:my-4 [&_pre]:overflow-x-auto [&_pre]:rounded-(--r-3) [&_pre]:bg-(--bg-sunk) [&_pre]:p-4 [&_pre]:text-xs " +
                                    "[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-[0.85em] " +
                                    // Tabelas (remark-gfm)
                                    "[&_table]:my-4 [&_table]:w-full [&_table]:border-collapse [&_table]:text-sm " +
                                    "[&_th]:border [&_th]:border-(--line) [&_th]:bg-(--bg-sunk) [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold [&_th]:text-(--ink) " +
                                    "[&_td]:border [&_td]:border-(--line) [&_td]:px-3 [&_td]:py-2 " +
                                    // Linha horizontal
                                    "[&_hr]:my-6 [&_hr]:border-(--line) " +
                                    // Mídia inline (imagens e vídeos).
                                    // `max-w-full` evita estouro horizontal,
                                    // `h-auto` mantém a proporção e o
                                    // raio + sombra alinham com a estética
                                    // do produto.
                                    "[&_img]:my-4 [&_img]:max-w-full [&_img]:h-auto [&_img]:rounded-(--r-3) [&_img]:border [&_img]:border-(--line) " +
                                    "[&_video]:my-4 [&_video]:max-w-full [&_video]:rounded-(--r-3) [&_video]:border [&_video]:border-(--line) [&_video]:bg-black"
                                }
                            >
                                <ReactMarkdown
                                    remarkPlugins={[remarkGfm]}
                                    rehypePlugins={[
                                        // `rehypeRaw` interpreta HTML
                                        // bruto (ex.: `<video src="…">`)
                                        // dentro do markdown. Precisa
                                        // vir antes do sanitize para
                                        // que as tags virem nós AST e
                                        // depois sejam validadas pela
                                        // allowlist. Sem isso, o
                                        // markdown trataria o `<video>`
                                        // como texto literal.
                                        rehypeRaw,
                                        [rehypeSanitize, SANITIZE_SCHEMA],
                                    ]}
                                >
                                    {article.body}
                                </ReactMarkdown>
                            </div>
                        </CardContent>
                    </Card>
                </article>

                {/* Coluna lateral — metadados do artigo. */}
                <aside aria-label="Informações do artigo" className="lg:sticky lg:top-4 lg:self-start">
                    <Card>
                        <CardContent className="flex flex-col gap-4 p-5">
                            <div className="flex flex-col gap-1.5">
                                <span className="text-xs uppercase tracking-wide text-(--ink-3)">
                                    Categoria
                                </span>
                                <CategoryChip
                                    icon={categoryIcon}
                                    label={categoryLabel}
                                />
                            </div>

                            <div className="flex flex-col gap-1.5">
                                <span className="text-xs uppercase tracking-wide text-(--ink-3)">
                                    Autor
                                </span>
                                <span className="inline-flex min-w-0 items-center gap-2">
                                    <Avatar
                                        name={authorName}
                                        {...(author?.avatarColor
                                            ? { color: author.avatarColor }
                                            : {})}
                                        {...(author?.avatarUrl
                                            ? { src: author.avatarUrl }
                                            : {})}
                                        size="sm"
                                    />
                                    <span className="min-w-0 truncate text-sm text-(--ink)" title={authorName}>
                                        {authorName}
                                    </span>
                                </span>
                            </div>

                            <div className="flex flex-col gap-1.5">
                                <span className="text-xs uppercase tracking-wide text-(--ink-3)">
                                    Atualizado
                                </span>
                                <span className="text-sm text-(--ink-2)">
                                    {fmtDateTime(article.updatedAt)}
                                </span>
                            </div>

                            <div className="flex flex-col gap-1.5">
                                <span className="text-xs uppercase tracking-wide text-(--ink-3)">
                                    Publicado em
                                </span>
                                <span className="text-sm text-(--ink-2)">
                                    {fmtDateTime(article.createdAt)}
                                </span>
                            </div>

                            <div className="flex items-center justify-between gap-2 border-t border-(--line) pt-4">
                                <span className="inline-flex items-center gap-1.5 text-sm text-(--ink-3)">
                                    <Eye aria-hidden="true" className="size-4" />
                                    <span className="tabular-nums">
                                        {article.views}
                                    </span>
                                    <span>
                                        {article.views === 1
                                            ? "visualização"
                                            : "visualizações"}
                                    </span>
                                </span>
                                {!article.published ? (
                                    <Badge tone="amber">Rascunho</Badge>
                                ) : null}
                            </div>
                        </CardContent>
                    </Card>
                </aside>
            </div>
        </div>
    );
}
