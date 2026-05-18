/**
 * Página `/tickets/novo` (Server Component).
 *
 * Renderiza o formulário de criação de ticket. O componente interativo
 * (`TicketForm` em `components/domain/ticket-form.tsx`) é um Client
 * Component "burro" que faz validação Zod, upload incremental e expõe
 * `onSubmit`. Aqui só precisamos:
 *
 * 1. **Verificar a sessão** via `auth()` e redirecionar para `/login`
 *    quando ausente — defesa em profundidade sobre o middleware
 *    (R1.1, R1.7). Qualquer usuário autenticado pode abrir um chamado
 *    (R3.7), então não há RBAC adicional além disso.
 * 2. **Carregar as taxonomias** que populam os selects do formulário:
 *    categorias **ativas** (`active=true`, R15.6 — categorias
 *    inativas continuam visíveis em tickets existentes mas somem dos
 *    formulários de criação) e todos os departamentos. Ambas via
 *    `reads.service` cacheado em memória (TTL 60s, R15.3).
 * 3. **Delegar** a interação para `NewTicketForm`, que é um Client
 *    Component sibling responsável por chamar `createTicketAction`,
 *    tratar `ActionResult` e redirecionar para `/tickets/{id}` em
 *    sucesso (R3.7).
 *
 * Por que o wrapper `NewTicketForm` em vez de passar a action direto
 * para `TicketForm`? Porque o contrato do `TicketForm.onSubmit` retorna
 * `{ ok, id | message }` (não `ActionResult`) e o redirect usa
 * `useRouter` — ambas necessidades de cliente. Manter o page.tsx como
 * Server Component puro fica mais limpo e mantém a página alinhada com
 * o resto do app (`/tickets`, `/perfil`, `/admin/sla`).
 *
 * Validates: R3.7.
 */

import { redirect } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { auth } from "@/lib/auth";
import { listCategories, listDepartments } from "@/services/reads.service";
import type { SessionUser } from "@/types/domain";

import { NewTicketForm } from "./new-ticket-form";

export default async function NewTicketPage() {
    // Sessão obrigatória — middleware já protege, mas o redirect aqui
    // evita que qualquer coisa abaixo execute sem `session.user`.
    const session = await auth();
    if (!session?.user) {
        redirect("/login");
    }
    // O destructure abaixo apenas documenta o tipo do actor; a página
    // em si não precisa do objeto, já que `createTicketAction` lê a
    // sessão de novo no servidor.
    const _actor = session.user satisfies SessionUser;
    void _actor;

    // Leituras estáveis em paralelo (cache TTL 60s, R15.3). Categorias
    // inativas são filtradas aqui — `listCategories()` devolve o
    // catálogo completo para a UI administrativa, e cada caller decide
    // o subset que faz sentido (R15.6).
    const [allCategories, departments] = await Promise.all([
        listCategories(),
        listDepartments(),
    ]);
    const categories = allCategories.filter((c) => c.active);

    return (
        <div>
            <PageHeader
                title="Novo ticket"
                description="Abra um chamado para o time de TI"
            />
            <NewTicketForm categories={categories} departments={departments} />
        </div>
    );
}
