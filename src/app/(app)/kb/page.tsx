/**
 * Página `/kb` (Server Component).
 *
 * Listagem da Base de Conhecimento. Carrega categorias e artigos
 * visíveis ao usuário autenticado e os apresenta em layout de duas
 * colunas: trilha de categorias à esquerda, cards de artigos à
 * direita. Tudo é servido pelo `kb.service`, que já aplica:
 *
 * - **Visibilidade por papel** (R13.1, R13.2): solicitantes recebem
 *   apenas artigos publicados; `tecnico`/`admin` recebem publicados
 *   **e** rascunhos de autoria própria. A regra mora em
 *   `listArticlesForUser` — esta página apenas repassa o `SessionUser`.
 * - **Busca textual** (R13.3): o termo digitado em `q` é encaminhado
 *   ao serviço, que delega ao repositório a ordenação por relevância
 *   (correspondência no título antes de corpo).
 *
 * O componente é puro RSC: nenhum `"use client"`, nenhum hook. O
 * formulário de busca usa `method="get"` para permanecer URL-driven,
 * o que mantém estado compartilhável e rastreável pelo histórico do
 * navegador sem exigir um componente cliente adicional. O filtro de
 * categoria é exposto como link `?category=<id>` na trilha esquerda
 * — também URL-driven — e a busca é preservada quando o usuário
 * troca de categoria.
 *
 * O CTA "Novo artigo" só aparece para `tecnico`/`admin`. A validação
 * autoritativa do acesso a `/kb/novo` mora no middleware/policy
 * (R13.9); aqui o objetivo é apenas evitar exibir um link que o
 * solicitante não conseguiria seguir.
 *
 * Validates: R13.1, R13.2, R13.3.
 */

import Link from "next/link";
import { redirect } from "next/navigation";

import { Plus, Search } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card"; import { Input } from "@/components/ui/input";
import { auth } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { canCreateKbArticle } from "@/lib/policies";
import {
    listArticlesForUser,
    listCategories as listKbCategories,
} from "@/services/kb.service";
import type { SessionUser } from "@/types/domain";

/**
 * Em Next 15 `searchParams` chega como `Promise` e precisa ser `await`-ada
 * antes do uso (mesmo padrão de `(app)/tickets/page.tsx`).
 */
type SearchParamsBag = Record<string, string | string[] | undefined>;

interface KbPageProps {
    searchParams: Promise<SearchParamsBag>;
}

/**
 * Reduz um valor `searchParam` (que pode ser `string | string[] |
 * undefined`) ao primeiro valor não-vazio. Filtros desta página são
 * single-valued — chaves repetidas são tratadas como o primeiro valor.
 */
function pickFirst(value: string | string[] | undefined): string | undefined {
    if (Array.isArray(value)) return value[0];
    return value;
}

/**
 * Constrói uma URL `/kb?...` preservando os filtros atuais e
 * substituindo `category` pelo valor informado. `null` limpa o filtro
 * (usado pelo link "Todas as categorias").
 */
function buildCategoryHref(
    params: SearchParamsBag,
    categoryId: string | null,
): string {
    const sp = new URLSearchParams();
    const q = pickFirst(params.q);
    if (q && q.trim().length > 0) {
        sp.set("q", q.trim());
    }
    if (categoryId) {
        sp.set("category", categoryId);
    }
    const qs = sp.toString();
    return qs.length > 0 ? `/kb?${qs}` : "/kb";
}

export default async function KbPage({ searchParams }: KbPageProps) {
    // Defesa em profundidade — middleware já bloqueia anônimos, mas o
    // redirect explícito garante que nenhum bloco abaixo execute sem
    // `session.user` populado (R1.1, R1.7).
    const session = await auth();
    if (!session?.user) {
        redirect("/login");
    }
    const user = session.user satisfies SessionUser;

    const params = await searchParams;
    const rawQuery = pickFirst(params.q);
    const query = rawQuery && rawQuery.trim().length > 0 ? rawQuery.trim() : undefined;
    const rawCategory = pickFirst(params.category);
    const categoryId =
        rawCategory && rawCategory.length > 0 ? rawCategory : undefined;

    // Leituras independentes em paralelo. As duas são pequenas e
    // localizadas; nenhuma justifica caching adicional aqui.
    const [categories, articles] = await Promise.all([
        listKbCategories(),
        listArticlesForUser(user, {
            ...(query !== undefined ? { search: query } : {}),
            ...(categoryId !== undefined ? { categoryId } : {}),
        }),
    ]);

    const categoryById = new Map(categories.map((c) => [c.id, c]));
    const activeCategory = categoryId
        ? categoryById.get(categoryId)
        : undefined;
    const canAuthor = canCreateKbArticle(user);

    return (
        <div>
            <PageHeader
                title="Base de conhecimento"
                description="Artigos e procedimentos"
                actions={
                    <div className="flex items-center gap-2">
                        <form
                            action="/kb"
                            method="get"
                            role="search"
                            aria-label="Buscar artigos"
                            className="relative"
                        >
                            {/* Preserva o filtro de categoria ao submeter
                                a busca — sem isso, o submit limparia o
                                `?category=...` atual. */}
                            {categoryId ? (
                                <input
                                    type="hidden"
                                    name="category"
                                    value={categoryId}
                                />
                            ) : null}
                            <Search
                                aria-hidden="true"
                                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-(--ink-3)"
                            />
                            <Input
                                type="search"
                                name="q"
                                defaultValue={query ?? ""}
                                placeholder="Buscar artigos…"
                                aria-label="Termo de busca"
                                className="w-64 pl-9"
                            />
                        </form>
                        {canAuthor ? (
                            <Button variant="primary" asChild icon={<Plus />}>
                                <Link href="/kb/novo">Novo artigo</Link>
                            </Button>
                        ) : null}
                    </div>
                }
            />

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[16rem_1fr]">
                {/* Trilha de categorias (R13.1). */}
                <aside aria-label="Categorias" className="lg:sticky lg:top-4">
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-sm">
                                Categorias
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="pb-4">
                            <ul className="flex flex-col gap-0.5">
                                <li>
                                    <Link
                                        href={buildCategoryHref(params, null)}
                                        aria-current={
                                            categoryId === undefined
                                                ? "page"
                                                : undefined
                                        }
                                        className={cn(
                                            "flex items-center justify-between rounded-(--r-2) px-2.5 py-1.5 text-sm",
                                            "outline-none focus-visible:ring-2 focus-visible:ring-(--accent)",
                                            categoryId === undefined
                                                ? "bg-(--accent-soft) text-(--accent)"
                                                : "text-(--ink-2) hover:bg-(--accent-soft-2)",
                                        )}
                                    >
                                        <span>Todas as categorias</span>
                                    </Link>
                                </li>
                                {categories.map((cat) => {
                                    const active = categoryId === cat.id;
                                    return (
                                        <li key={cat.id}>
                                            <Link
                                                href={buildCategoryHref(
                                                    params,
                                                    cat.id,
                                                )}
                                                aria-current={
                                                    active ? "page" : undefined
                                                }
                                                className={cn(
                                                    "flex items-center justify-between rounded-(--r-2) px-2.5 py-1.5 text-sm",
                                                    "outline-none focus-visible:ring-2 focus-visible:ring-(--accent)",
                                                    active
                                                        ? "bg-(--accent-soft) text-(--accent)"
                                                        : "text-(--ink-2) hover:bg-(--accent-soft-2)",
                                                )}
                                            >
                                                <span className="truncate">
                                                    {cat.label}
                                                </span>
                                            </Link>
                                        </li>
                                    );
                                })}
                            </ul>
                        </CardContent>
                    </Card>
                </aside>

                {/* Lista de artigos. */}
                <section aria-label="Artigos">
                    {/* Cabeçalho contextual: indica o escopo atual da
                        listagem (filtro de categoria e/ou busca). */}
                    {(activeCategory || query) ? (
                        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-(--ink-3)">
                            {activeCategory ? (
                                <span>
                                    Categoria:{" "}
                                    <span className="font-medium text-(--ink-2)">
                                        {activeCategory.label}
                                    </span>
                                </span>
                            ) : null}
                            {activeCategory && query ? (
                                <span aria-hidden="true">·</span>
                            ) : null}
                            {query ? (
                                <span>
                                    Busca:{" "}
                                    <span className="font-medium text-(--ink-2)">
                                        “{query}”
                                    </span>
                                </span>
                            ) : null}
                            <Link
                                href="/kb"
                                className={cn(
                                    "ml-1 underline-offset-2 hover:text-(--ink)",
                                    "hover:underline focus-visible:outline-none focus-visible:ring-2",
                                    "focus-visible:ring-(--accent) focus-visible:ring-offset-2",
                                    "focus-visible:ring-offset-(--bg)",
                                )}
                            >
                                Limpar
                            </Link>
                        </div>
                    ) : null}

                    {articles.length === 0 ? (
                        <Card>
                            <CardContent className="py-12 text-center">
                                <p className="text-sm text-(--ink-3)">
                                    {query
                                        ? "Nenhum artigo corresponde à busca."
                                        : "Nenhum artigo disponível."}
                                </p>
                            </CardContent>
                        </Card>
                    ) : (
                        <ul className="flex flex-col gap-3">
                            {articles.map((article) => {
                                const cat = categoryById.get(
                                    article.categoryId,
                                );
                                return (
                                    <li key={article.id}>
                                        <Link
                                            href={`/kb/${article.slug}`}
                                            className={cn(
                                                "block rounded-(--r-4)",
                                                "outline-none focus-visible:ring-2 focus-visible:ring-(--accent)",
                                                "focus-visible:ring-offset-2 focus-visible:ring-offset-(--bg)",
                                            )}
                                        >
                                            <Card className="transition-colors hover:bg-(--bg-sunk)">
                                                <CardHeader className="py-3">
                                                    <div className="flex items-start justify-between gap-3">
                                                        <CardTitle className="truncate text-base">
                                                            {article.title}
                                                        </CardTitle>
                                                        {!article.published ? (
                                                            <Badge tone="amber">
                                                                Rascunho
                                                            </Badge>
                                                        ) : null}
                                                    </div>
                                                    {cat ? (
                                                        <CardDescription className="text-xs">
                                                            {cat.label}
                                                        </CardDescription>
                                                    ) : null}
                                                </CardHeader>
                                            </Card>
                                        </Link>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </section>
            </div>
        </div>
    );
}
