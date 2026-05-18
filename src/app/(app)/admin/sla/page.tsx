/**
 * Página `/admin/sla` (Server Component).
 *
 * Painel administrativo que exibe a Politica_SLA vigente para cada
 * prioridade e permite ao Admin ajustar as horas (R15.1, R15.2). A
 * persistência e a invalidação do cache de leituras estáveis (R15.3)
 * ficam a cargo da Server Action `updateSlaPolicyAction`, disparada pelo
 * Client Component `SlaPoliciesForm`.
 *
 * Responsabilidades do RSC:
 *
 * 1. **Verificar a sessão** via `auth()` e redirecionar para `/login`
 *    quando ausente — defesa em profundidade sobre o middleware
 *    (R1.1, R1.7).
 * 2. **Aplicar RBAC** com `canManageSla(user)` e redirecionar
 *    não-admins para `/dashboard` (R2.8, R15). O middleware já bloqueia
 *    `/admin/*` para outros papéis, mas o redirect explícito garante
 *    que nenhum bloco abaixo execute sem o papel correto.
 * 3. **Carregar as políticas atuais** via `getAllSlaPolicies()`, que usa
 *    o cache estável (TTL 60s) — leitura barata e consistente com o que
 *    o restante do app enxerga.
 *
 * A interação (inputs controlados, transição de pending state, toasts)
 * é totalmente client-side; o RSC apenas hidrata `initialPolicies` no
 * Client Component.
 *
 * Validates: R15.1, R15.2, R15.3.
 */

import { redirect } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { auth } from "@/lib/auth";
import { canManageSla } from "@/lib/policies";
import { getAllSlaPolicies } from "@/services/reads.service";
import type { SessionUser } from "@/types/domain";

import { SlaPoliciesForm } from "./sla-policies-form";

export default async function AdminSlaPage() {
    // Sessão obrigatória — middleware já protege, mas o redirect aqui
    // evita que qualquer coisa abaixo execute sem `session.user`.
    const session = await auth();
    if (!session?.user) {
        redirect("/login");
    }
    const actor = session.user satisfies SessionUser;

    // RBAC explícito — apenas `admin` opera as políticas de SLA (R15).
    // Não-admins voltam para o dashboard sem feedback de erro,
    // alinhado a R2.8.
    if (!canManageSla(actor)) {
        redirect("/dashboard");
    }

    // Leitura cacheada (TTL 60s, R15.3). Mutações via `updateSlaPolicy`
    // invalidam o cache, então a próxima visita a esta página verá o
    // novo estado sem aguardar a expiração natural.
    const policies = await getAllSlaPolicies();

    return (
        <div>
            <PageHeader
                title="Políticas de SLA"
                description="Prazos por prioridade"
            />
            <SlaPoliciesForm initialPolicies={policies} />
        </div>
    );
}
