/**
 * Página `/admin/usuarios` (Server Component).
 *
 * Painel administrativo para gestão de contas e papéis (R14). Carrega a
 * listagem completa de usuários e a taxonomia de departamentos no
 * servidor e delega a interação (criação, desativação, alteração de
 * papel) para o Client Component `UsersManagement`, que orquestra os
 * Server Actions exportados em `@/actions/admin`.
 *
 * Responsabilidades do RSC:
 *
 * 1. **Verificar a sessão** via `auth()` e redirecionar para `/login`
 *    quando ausente — defesa em profundidade sobre o middleware
 *    (R1.1, R1.7).
 * 2. **Aplicar RBAC** com `canManageUsers(user)` e redirecionar
 *    não-admins para `/dashboard` (R2.8, R14). O middleware já bloqueia
 *    `/admin/*` para outros papéis, mas o redirect explícito garante
 *    que nenhum bloco abaixo execute sem o papel correto.
 * 3. **Carregar dados** em paralelo: a lista completa de usuários (via
 *    `users.repo.listAll`) e a lista de departamentos (via
 *    `reads.service.listDepartments`, com cache TTL 60s — R15.3).
 *
 * A renderização da tabela e dos diálogos é totalmente client-side
 * porque envolve handlers imperativos (Select que dispara mutação ao
 * mudar, Dialog com formulário controlado) e o uso da fila de toasts
 * (R14.3 — conflito de email exibe toast de erro).
 *
 * Validates: R14.
 */

import { redirect } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { listAll } from "@/db/repositories/users.repo";
import { db } from "@/db/client";
import { auth } from "@/lib/auth";
import { canManageUsers } from "@/lib/policies";
import { listDepartments } from "@/services/reads.service";
import type { SessionUser } from "@/types/domain";

import { UsersManagement } from "./users-management";

export default async function AdminUsersPage() {
    // Sessão obrigatória — middleware já protege, mas o redirect aqui
    // evita que qualquer coisa abaixo execute sem `session.user`.
    const session = await auth();
    if (!session?.user) {
        redirect("/login");
    }
    const actor = session.user satisfies SessionUser;

    // RBAC explícito — apenas `admin` opera o cadastro de usuários
    // (R14). Não-admins voltam para o dashboard sem feedback de erro,
    // alinhado a R2.8.
    if (!canManageUsers(actor)) {
        redirect("/dashboard");
    }

    // Leituras em paralelo: listagem completa de usuários e taxonomia
    // de departamentos (essa última cacheada via `reads.service`).
    const [users, departments] = await Promise.all([
        listAll(db),
        listDepartments(),
    ]);

    return (
        <div>
            <PageHeader
                title="Usuários"
                description="Gestão de contas e papéis"
            />
            <UsersManagement
                users={users}
                departments={departments}
                currentUserId={actor.id}
            />
        </div>
    );
}
