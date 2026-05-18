/**
 * Página `/kb/novo` (Server Component).
 *
 * Renderiza o formulário de criação de um artigo da Base de Conhecimento.
 * O componente interativo (`NewKbArticleForm` em
 * `new-kb-article-form.tsx`) é um Client Component sibling responsável
 * pela validação Zod, derivação automática do slug, chamada à Server
 * Action `createArticleAction` e redirecionamento para `/kb/{slug}` em
 * sucesso.
 *
 * Responsabilidades do RSC:
 *
 * 1. **Verificar a sessão** via `auth()` e redirecionar para `/login`
 *    quando ausente — defesa em profundidade sobre o middleware
 *    (R1.1, R1.7).
 * 2. **Aplicar RBAC** com `canCreateKbArticle(actor)` e redirecionar
 *    solicitantes para `/kb` (R13.9). O middleware já bloqueia, mas o
 *    redirect explícito garante que nenhum bloco abaixo execute sem o
 *    papel correto e mantém a página robusta caso a configuração de
 *    rotas do middleware mude no futuro.
 * 3. **Carregar as categorias da KB** via `kb.service.listCategories()`
 *    para popular o select do formulário. A leitura é simples e
 *    pequena; não justifica caching adicional além do já aplicado pelo
 *    repositório.
 *
 * A escolha do papel padrão para `published` (`true`) fica no Client
 * Component — admin/tecnico tipicamente publicam direto, mas qualquer
 * autor pode desmarcar para salvar como rascunho (R13.4).
 *
 * Validates: R13.4, R13.5, R13.9.
 */

import { redirect } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { auth } from "@/lib/auth";
import { canCreateKbArticle } from "@/lib/policies";
import { listCategories } from "@/services/kb.service";
import type { SessionUser } from "@/types/domain";

import { NewKbArticleForm } from "./new-kb-article-form";

export default async function NewKbArticlePage() {
    // Sessão obrigatória — middleware já protege, mas o redirect aqui
    // evita que qualquer coisa abaixo execute sem `session.user`.
    const session = await auth();
    if (!session?.user) {
        redirect("/login");
    }
    const actor = session.user satisfies SessionUser;

    // RBAC explícito — solicitantes não podem redigir artigos (R13.9).
    // O middleware já barra o acesso administrativo, mas o redirect
    // explícito mantém a página robusta para qualquer mudança futura
    // na configuração de rotas e para chamadas server-side internas.
    if (!canCreateKbArticle(actor)) {
        redirect("/kb");
    }

    // Categorias para o select. Lista pequena, sem regras de
    // visibilidade — todas as categorias servem a qualquer autor.
    const categories = await listCategories();

    return (
        <div>
            <PageHeader
                title="Novo artigo"
                description="Publique um procedimento ou solução para o time"
            />
            <NewKbArticleForm categories={categories} />
        </div>
    );
}
