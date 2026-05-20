/**
 * Página `/tickets/atribuidos` (Server Component).
 *
 * Lista os tickets em que o usuário corrente é o **responsável**
 * (`assigneeId = user.id`), reaproveitando a infraestrutura de listagem
 * de `/tickets` (R5.7).
 *
 * Regras específicas:
 *
 * - **Acesso restrito**: solicitantes não possuem tickets atribuídos a
 *   si próprios — a rota é redirecionada para `/tickets` quando
 *   `user.role === "solicitante"`. O middleware já protege contra
 *   anônimos; o `redirect("/login")` aqui é defesa em profundidade.
 * - **Filtro implícito** `assigneeId = "me"`: o repositório resolve o
 *   literal `"me"` para `user.id` no SQL, garantindo que mesmo um bug
 *   na UI não exponha tickets de outro técnico.
 * - **Exclusão de `fechado`**: tickets já fechados deixam de ser
 *   relevantes para a fila de trabalho do responsável e são filtrados
 *   após a leitura (o repositório não expõe negação de `status` e
 *   adicioná-la sai do escopo desta task).
 * - **UI minimalista**: sem barra de filtros e sem paginação por
 *   cursor. A leitura usa o limite máximo do repositório (200), o que
 *   cobre com folga a fila de qualquer técnico individual; quando esse
 *   teto for atingido, a evolução natural é introduzir paginação.
 *
 * Validates: R5.7
 */

import { redirect } from "next/navigation";

import { inArray } from "drizzle-orm";

import {
    type TicketRowData,
} from "@/components/domain/ticket-row";
import { TicketsDataTable } from "@/components/domain/tickets-data-table";
import { PageHeader } from "@/components/layout/page-header";
import { db } from "@/db/client";
import { listWithFilters } from "@/db/repositories/tickets.repo";
import { users } from "@/db/schema";
import { auth } from "@/lib/auth";
import {
    getAllSlaPolicies,
    listCategories,
    listDepartments,
} from "@/services/reads.service";
import type { SessionUser, Ticket } from "@/types/domain";

/**
 * Limite alto o suficiente para cobrir a fila inteira de um técnico
 * sem paginação. Coerente com `MAX_LIST_LIMIT` do repositório (200).
 */
const ASSIGNED_LIST_LIMIT = 200;

/**
 * Enriquecimento das linhas do repositório para `TicketRowData`.
 *
 * Espelha a função homônima de `/tickets/page.tsx`. Mantida local para
 * preservar o escopo desta página — extrair para um helper compartilhado
 * é uma evolução natural quando uma terceira tela de listagem de tickets
 * surgir.
 */
function enrichRows(
    rows: Ticket[],
    categoryById: Map<
        string,
        { label: string; sub: string; icon: string }
    >,
    departmentById: Map<string, { name: string }>,
    userById: Map<
        string,
        { name: string; avatarColor: string; avatarUrl: string | null }
    >,
): TicketRowData[] {
    return rows.map((ticket) => {
        const cat = categoryById.get(ticket.categoryId);
        const dept = departmentById.get(ticket.departmentId);
        const requester = userById.get(ticket.requesterId);
        const assignee = ticket.assigneeId
            ? userById.get(ticket.assigneeId)
            : undefined;

        return {
            id: ticket.id,
            title: ticket.title,
            status: ticket.status,
            priority: ticket.priority,
            categoryIcon: cat?.icon ?? "tag",
            categoryLabel: cat?.label ?? ticket.categoryId,
            ...(cat?.sub ? { categorySub: cat.sub } : {}),
            requesterName: requester?.name ?? "—",
            ...(requester?.avatarColor
                ? { requesterAvatarColor: requester.avatarColor }
                : {}),
            ...(requester?.avatarUrl
                ? { requesterAvatarUrl: requester.avatarUrl }
                : {}),
            assigneeName: assignee ? assignee.name : null,
            ...(assignee?.avatarColor
                ? { assigneeAvatarColor: assignee.avatarColor }
                : {}),
            ...(assignee?.avatarUrl
                ? { assigneeAvatarUrl: assignee.avatarUrl }
                : {}),
            ...(dept?.name ? { departmentLabel: dept.name } : {}),
            slaDeadline: ticket.slaDeadline,
            createdAt: ticket.createdAt,
            updatedAt: ticket.updatedAt,
        };
    });
}

export default async function AtribuidosPage() {
    const session = await auth();
    if (!session?.user) {
        redirect("/login");
    }
    const user = session.user satisfies SessionUser;

    // Solicitantes não têm responsável atribuído a si mesmos. Encaminha
    // para a listagem geral (que já aplica o filtro implícito por
    // `requesterId = user.id`).
    if (user.role === "solicitante") {
        redirect("/tickets");
    }

    const [policies, categories, departments, page] = await Promise.all([
        getAllSlaPolicies(),
        listCategories(),
        listDepartments(),
        listWithFilters(db, user, {
            assigneeId: "me",
            limit: ASSIGNED_LIST_LIMIT,
        }),
    ]);

    // Tickets fechados saem da fila de trabalho — não há ação pendente
    // do responsável sobre eles. Filtrado em JS porque o repositório
    // não expõe negação de `status` e o teto de 200 linhas mantém o
    // custo desprezível.
    const activeRows = page.rows.filter((ticket) => ticket.status !== "fechado");

    // Coleção mínima de usuários para resolver nomes de solicitante e
    // responsável em uma única query, evitando N+1.
    const userIds = new Set<string>();
    for (const ticket of activeRows) {
        userIds.add(ticket.requesterId);
        if (ticket.assigneeId) userIds.add(ticket.assigneeId);
    }
    const userRows =
        userIds.size > 0
            ? await db
                .select({
                    id: users.id,
                    name: users.name,
                    avatarColor: users.avatarColor,
                    avatarUrl: users.avatarUrl,
                })
                .from(users)
                .where(inArray(users.id, Array.from(userIds)))
            : [];

    const categoryById = new Map(
        categories.map((c) => [
            c.id,
            { label: c.label, sub: c.sub, icon: c.icon },
        ]),
    );
    const departmentById = new Map(
        departments.map((d) => [d.id, { name: d.name }]),
    );
    const userById = new Map(
        userRows.map((u) => [
            u.id,
            { name: u.name, avatarColor: u.avatarColor, avatarUrl: u.avatarUrl },
        ]),
    );

    const rows = enrichRows(activeRows, categoryById, departmentById, userById);

    return (
        <div>
            <PageHeader
                title="Atribuídos a mim"
                description="Tickets em que você é o responsável"
            />

            <TicketsDataTable rows={rows} policies={policies} />
        </div>
    );
}
