/**
 * Página `/perfil` (Server Component).
 *
 * Exibe os dados do usuário autenticado (nome, email, papel,
 * departamento, cor de avatar) e oferece o formulário de troca de
 * senha (R1.6). Qualquer usuário autenticado pode acessar a própria
 * página de perfil — não há RBAC adicional além da autenticação, já
 * que a operação afeta apenas a conta corrente.
 *
 * Responsabilidades do RSC:
 *
 * 1. **Verificar a sessão** via `auth()` e redirecionar para `/login`
 *    quando ausente — defesa em profundidade sobre o middleware
 *    (R1.1, R1.7).
 * 2. **Carregar o registro completo** do usuário corrente via
 *    `findById`. A sessão JWT carrega apenas `id`, `email`, `name`,
 *    `role` e `departmentId` (R1.6); a página precisa do `avatarColor`
 *    para renderizar o avatar com a cor persistida no banco. Se o
 *    registro não existir mais (cenário extremo, ex.: conta apagada
 *    enquanto a sessão estava aberta), reciclamos para `/login` para
 *    forçar reautenticação.
 * 3. **Resolver o nome do departamento** (quando há) via
 *    `listDepartments()` cacheada (TTL 60s, R15.3) — leitura barata e
 *    consistente com o restante do app. Departamentos em si raramente
 *    mudam, então o cache costuma servir o resultado sem ir ao banco.
 *
 * A interação (formulário de troca de senha, transição de pending state,
 * toasts) é totalmente client-side; o RSC apenas hidrata os dados de
 * exibição no Client Component `ProfileForm`.
 *
 * Validates: R1.6.
 */

import { redirect } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { db } from "@/db/client";
import { findById } from "@/db/repositories/users.repo";
import { auth } from "@/lib/auth";
import { listDepartments } from "@/services/reads.service";
import type { SessionUser } from "@/types/domain";

import { ProfileForm } from "./profile-form";

export default async function ProfilePage() {
    // Sessão obrigatória — middleware já protege, mas o redirect aqui
    // evita que qualquer coisa abaixo execute sem `session.user`.
    const session = await auth();
    if (!session?.user) {
        redirect("/login");
    }
    const actor = session.user satisfies SessionUser;

    // Carrega o registro completo (precisamos de `avatarColor`, que
    // não viaja na sessão JWT). Conta deletada → manda para /login.
    const userRow = await findById(db, actor.id);
    if (!userRow) {
        redirect("/login");
    }

    // Resolve o nome do departamento via cache estável (R15.3). A
    // taxonomia tem dezenas de itens no máximo, então o lookup
    // in-memory é mais simples que um JOIN dedicado.
    const departments = await listDepartments();
    const departmentName = userRow.departmentId
        ? (departments.find((d) => d.id === userRow.departmentId)?.name ??
            null)
        : null;

    return (
        <div>
            <PageHeader
                title="Perfil"
                description="Seus dados de acesso e configurações pessoais"
            />
            <ProfileForm
                name={userRow.name}
                email={userRow.email}
                role={userRow.role}
                departmentName={departmentName}
                avatarColor={userRow.avatarColor}
                avatarUrl={userRow.avatarUrl}
            />
        </div>
    );
}
