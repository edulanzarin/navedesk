/**
 * Página `/admin/departamentos` (Server Component).
 *
 * Painel administrativo que lista todos os departamentos cadastrados
 * (`id`, `name`) e permite ao Admin criá-los, renomeá-los e excluí-los.
 * A persistência e a invalidação do cache de leituras estáveis (R15.3)
 * ficam a cargo das Server Actions `createDepartmentAction`,
 * `updateDepartmentAction` e `deleteDepartmentAction`, disparadas pelo
 * Client Component `DepartmentsManagement`.
 *
 * Responsabilidades do RSC:
 *
 * 1. **Verificar a sessão** via `auth()` e redirecionar para `/login`
 *    quando ausente — defesa em profundidade sobre o middleware
 *    (R1.1, R1.7).
 * 2. **Aplicar RBAC** com `canManageDepartments(user)` e redirecionar
 *    não-admins para `/dashboard` (R2.8). O middleware já bloqueia
 *    `/admin/*` para outros papéis, mas o redirect explícito mantém
 *    a página robusta para qualquer mudança futura na configuração de
 *    rotas e para chamadas server-side internas.
 * 3. **Carregar a taxonomia atual** via `listDepartments()`, que usa o
 *    cache estável (TTL 60s).
 *
 * Validates: R15.
 */

import { redirect } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { auth } from "@/lib/auth";
import { canManageDepartments } from "@/lib/policies";
import { listDepartments } from "@/services/reads.service";
import type { SessionUser } from "@/types/domain";

import { DepartmentsManagement } from "./departments-management";

export default async function AdminDepartmentsPage() {
    const session = await auth();
    if (!session?.user) {
        redirect("/login");
    }
    const actor = session.user satisfies SessionUser;

    if (!canManageDepartments(actor)) {
        redirect("/dashboard");
    }

    const departments = await listDepartments();

    return (
        <div>
            <PageHeader
                title="Departamentos"
                description="Estrutura organizacional usada para escopar tickets e usuários"
            />
            <DepartmentsManagement initialDepartments={departments} />
        </div>
    );
}
