/**
 * Página `/admin/categorias` (Server Component).
 *
 * Painel administrativo que lista todas as Categorias de chamado
 * (`id`, `label`, `sub`, `icon`, `active`) e permite ao Admin criá-las,
 * desativá-las e tentar excluí-las (R15.4–R15.7). A persistência e a
 * invalidação do cache de leituras estáveis (R15.3) ficam a cargo das
 * Server Actions `createCategoryAction`, `deactivateCategoryAction` e
 * `deleteCategoryAction`, disparadas pelo Client Component
 * `CategoriesManagement`.
 *
 * Responsabilidades do RSC:
 *
 * 1. **Verificar a sessão** via `auth()` e redirecionar para `/login`
 *    quando ausente — defesa em profundidade sobre o middleware
 *    (R1.1, R1.7).
 * 2. **Aplicar RBAC** com `canManageCategories(user)` e redirecionar
 *    não-admins para `/dashboard` (R2.8, R15). O middleware já bloqueia
 *    `/admin/*` para outros papéis, mas o redirect explícito garante
 *    que nenhum bloco abaixo execute sem o papel correto.
 * 3. **Carregar a taxonomia atual** via `listCategories()`, que usa o
 *    cache estável (TTL 60s) e devolve ativas e inativas — a página
 *    administrativa precisa enxergar ambas (R15.4, R15.6).
 *
 * Inclui ativas e inativas no payload porque o requisito R15.4 exige a
 * listagem completa; os formulários de abertura de ticket aplicam o
 * filtro `active=true` no consumidor (R15.6), em outro lugar.
 *
 * Validates: R15.4, R15.5, R15.6, R15.7.
 */

import { redirect } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { auth } from "@/lib/auth";
import { canManageCategories } from "@/lib/policies";
import { listCategories } from "@/services/reads.service";
import type { SessionUser } from "@/types/domain";

import { CategoriesManagement } from "./categories-management";

export default async function AdminCategoriesPage() {
    // Sessão obrigatória — middleware já protege, mas o redirect aqui
    // evita que qualquer coisa abaixo execute sem `session.user`.
    const session = await auth();
    if (!session?.user) {
        redirect("/login");
    }
    const actor = session.user satisfies SessionUser;

    // RBAC explícito — apenas `admin` opera o cadastro de categorias
    // (R15). Não-admins voltam para o dashboard sem feedback de erro,
    // alinhado a R2.8.
    if (!canManageCategories(actor)) {
        redirect("/dashboard");
    }

    // Leitura cacheada (TTL 60s, R15.3). Mutações via `createCategory`,
    // `deactivateCategory` e `deleteCategory` invalidam o cache, então a
    // próxima visita verá o novo estado sem aguardar a expiração.
    const categories = await listCategories();

    return (
        <div>
            <PageHeader
                title="Categorias"
                description="Taxonomia usada na abertura de chamados"
            />
            <CategoriesManagement initialCategories={categories} />
        </div>
    );
}
