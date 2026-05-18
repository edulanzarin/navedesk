/**
 * Server Actions de tickets do NaveDesk.
 *
 * Camada fina entre os formulários/handlers de UI (`/tickets/novo`,
 * `/tickets/{id}`) e o serviço `tickets.service`. Cada action segue o
 * mesmo pipeline já adotado em `actions/admin.ts`, `actions/kb.ts` e
 * `actions/messages.ts`:
 *
 * 1. Recupera o usuário autenticado via `auth()`. Sem sessão →
 *    `ActionResult.error.code="UNAUTHORIZED"`. Esta é a defesa em
 *    profundidade sobre o middleware: Server Actions são endpoints
 *    públicos do ponto de vista de segurança e podem ser invocadas
 *    diretamente via `fetch`, então cada action revalida a sessão.
 * 2. Delega para o serviço correspondente, que aplica a validação Zod
 *    de borda (em `createTicketAction`), as policies RBAC e a máquina
 *    de estados. O serviço já devolve um `ActionResult<T>` pronto, com
 *    `error.code` discriminado (`VALIDATION`, `FORBIDDEN`,
 *    `INVALID_TRANSITION`, `INVALID_ASSIGNEE`, `ATTACHMENT_INVALID`,
 *    `NOT_FOUND`) — esta camada nunca remapeia códigos para preservar o
 *    contrato esperado pelo cliente (R22.1, R22.2, R22.3).
 * 3. Em sucesso, dispara `revalidatePath` nas rotas afetadas. Toda
 *    mutação invalida `/tickets` (lista) e `/dashboard` (KPIs); as
 *    operações em um ticket específico também invalidam
 *    `/tickets/{id}` para refletir a mudança no detalhe sem reload
 *    manual (R12.8).
 *
 * `updateTicketAction` (mutações genéricas em campos descritivos do
 * ticket) ainda não tem operação correspondente em `tickets.service`
 * — o detalhe atual edita ticket apenas via fluxos específicos
 * (status, prioridade, atribuição, avaliação). Quando um caso de uso
 * exigir um update genérico, este arquivo ganhará a action seguindo o
 * mesmo padrão.
 *
 * Validates: R3.7, R12.8, R22.1.
 */

"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import * as ticketsService from "@/services/tickets.service";
import {
    exportTickets,
    type ExportPayload,
    type ExportTicketsInput,
} from "@/services/tickets-export.service";
import type {
    ActionResult,
    Priority,
    SessionUser,
    Ticket,
    TicketStatus,
} from "@/types/domain";

/**
 * Recupera o usuário autenticado da sessão atual. Retorna `null` para
 * requisições anônimas/expiradas. Centralizar a leitura aqui mantém os
 * pontos de entrada concisos e simplifica testes.
 */
async function getActor(): Promise<SessionUser | null> {
    const session = await auth();
    return (session?.user as SessionUser | undefined) ?? null;
}

/**
 * `ActionResult` compartilhado para erro `UNAUTHORIZED` (sessão ausente
 * ou inválida). As checagens de papel ficam a cargo do serviço, que
 * concentra todas as policies em um único lugar puro.
 */
function unauthorized<T>(): ActionResult<T> {
    return {
        ok: false,
        error: {
            code: "UNAUTHORIZED",
            message: "Sessão inválida.",
        },
    };
}

/**
 * Conjunto de rotas invalidadas após qualquer mutação em um ticket
 * específico (status, atribuição, avaliação). A página do detalhe é
 * passada como argumento porque depende do `id`; as listagens e o
 * dashboard são invariantes.
 *
 * R12.8: a UI deve refletir a mudança "sem reload manual".
 */
function revalidateTicketRoutes(ticketId: string): void {
    revalidatePath(`/tickets/${ticketId}`);
    revalidatePath("/tickets");
    revalidatePath("/tickets/atribuidos");
    revalidatePath("/dashboard");
}

/**
 * Cria um novo ticket a partir do formulário de `/tickets/novo`
 * (R3.7).
 *
 * O parse Zod (`CreateTicketSchema`) acontece dentro do serviço, que
 * devolve `ActionResult.error.code="VALIDATION"` apontando o primeiro
 * campo inválido — basta repassar o resultado tal qual. Em sucesso,
 * revalida `/tickets` e `/dashboard` para que a próxima navegação
 * mostre o ticket recém-criado nas listagens e KPIs; o redirect para
 * `/tickets/{id}` é feito pelo cliente após receber `data.id`.
 */
export async function createTicketAction(
    rawInput: unknown,
): Promise<ActionResult<Ticket>> {
    const actor = await getActor();
    if (!actor) return unauthorized<Ticket>();

    const result = await ticketsService.createTicket(actor, rawInput);
    if (result.ok) {
        revalidatePath("/tickets");
        revalidatePath("/dashboard");
    }
    return result;
}

/**
 * Altera o status de um ticket (R12.8).
 *
 * Delega ao serviço, que combina `canChangeStatus` com a máquina de
 * estados pura — combinações inválidas devolvem
 * `INVALID_TRANSITION`. A action revalida o detalhe e as listagens em
 * sucesso.
 */
export async function changeTicketStatusAction(
    id: string,
    nextStatus: TicketStatus,
): Promise<ActionResult<Ticket>> {
    const actor = await getActor();
    if (!actor) return unauthorized<Ticket>();

    const result = await ticketsService.changeTicketStatus(
        actor,
        id,
        nextStatus,
    );
    if (result.ok) revalidateTicketRoutes(id);
    return result;
}

/**
 * Altera a prioridade de um ticket (R12.3, R12.8, R16.3).
 *
 * Delega ao serviço, que aplica `canChangePriority` (admin ou técnico
 * responsável) e grava `priority_changed` na trilha de auditoria. O
 * `slaDeadline` original é intencionalmente preservado pelo serviço:
 * a reclassificação operacional não desfaz o prazo acordado quando o
 * ticket foi aberto.
 */
export async function changeTicketPriorityAction(
    id: string,
    nextPriority: Priority,
): Promise<ActionResult<Ticket>> {
    const actor = await getActor();
    if (!actor) return unauthorized<Ticket>();

    const result = await ticketsService.changeTicketPriority(
        actor,
        id,
        nextPriority,
    );
    if (result.ok) revalidateTicketRoutes(id);
    return result;
}

/**
 * Atribui o ticket a um usuário específico ou remove a atribuição
 * quando `assigneeId === null` (R12.8, R5.3, R5.5).
 *
 * Operação administrativa: o serviço exige `canAssignOthers` (admin)
 * para qualquer chamada com `assigneeId !== actor.id`. A validação do
 * destinatário (existe, ativo, papel `tecnico`/`admin`) também é
 * responsabilidade do serviço.
 */
export async function assignTicketAction(
    id: string,
    assigneeId: string | null,
): Promise<ActionResult<Ticket>> {
    const actor = await getActor();
    if (!actor) return unauthorized<Ticket>();

    const result = await ticketsService.assignTicket(actor, id, assigneeId);
    if (result.ok) revalidateTicketRoutes(id);
    return result;
}

/**
 * Atalho de auto-atribuição usado pelo botão "Assumir" em
 * `/tickets/{id}` (R5.1, R12.8).
 *
 * Delega a `assignTicketToMe`, que aplica `canAssignSelf` (rejeita
 * solicitantes e tickets `fechado`) e usa a ação `ASSIGN` da máquina
 * de estados — leva `aberto → andamento` automaticamente.
 */
export async function assignTicketToMeAction(
    id: string,
): Promise<ActionResult<Ticket>> {
    const actor = await getActor();
    if (!actor) return unauthorized<Ticket>();

    const result = await ticketsService.assignTicketToMe(actor, id);
    if (result.ok) revalidateTicketRoutes(id);
    return result;
}

/**
 * Remove a atribuição (assignee → null) de um ticket (R5.5, R16.5).
 *
 * Operação administrativa — o serviço aplica `canAssignOthers`. Útil
 * para corrigir designações equivocadas; não envolve a máquina de
 * estados (apenas grava o evento `unassigned`).
 */
export async function unassignTicketAction(
    id: string,
): Promise<ActionResult<Ticket>> {
    const actor = await getActor();
    if (!actor) return unauthorized<Ticket>();

    const result = await ticketsService.unassignTicket(actor, id);
    if (result.ok) revalidateTicketRoutes(id);
    return result;
}

/**
 * Registra a avaliação (1..5 estrelas) do solicitante após resolução
 * (R12.6, R12.8).
 *
 * O serviço aplica `canRateTicket` (apenas o autor do ticket em status
 * `resolvido` pode avaliar) e valida a faixa `1..5` em inteiros. O
 * cliente pode passar `stars` como `number` — o serviço normaliza para
 * o subtipo do domínio antes de gravar.
 */
export async function rateTicketAction(
    id: string,
    stars: number,
): Promise<ActionResult<Ticket>> {
    const actor = await getActor();
    if (!actor) return unauthorized<Ticket>();

    const result = await ticketsService.rateTicket(actor, id, stars);
    if (result.ok) revalidateTicketRoutes(id);
    return result;
}

/**
 * Gera um arquivo `.csv` (ou `.xlsx`, quando suportado) com a lista de
 * tickets respeitando os filtros correntes (R11.6, R11.7).
 *
 * O serviço cuida de:
 * - validar filtros + formato com Zod (`VALIDATION`);
 * - aplicar RBAC via `canExportTickets` (`FORBIDDEN`);
 * - escopar solicitantes ao próprio `requesterId` (delegado ao
 *   `tickets.repo.listWithFilters`, que injeta o filtro no SQL);
 * - limitar o resultado a 10.000 linhas, devolvendo `TOO_MANY_ROWS`
 *   quando excedido para que a UI peça ao usuário refinar os filtros.
 *
 * Nada é revalidado em sucesso: o export é uma operação de leitura
 * pura. O cliente recebe `{ filename, content, mimeType, encoding,
 * rowCount }` e dispara o download via `Blob` + `<a download>`.
 *
 * Para adicionar XLSX no futuro, basta instalar a dependência
 * (`xlsx`/`exceljs`) e expandir o branch correspondente em
 * `tickets-export.service.ts`; o contrato desta action permanece
 * estável.
 */
export async function exportTicketsAction(
    rawInput: ExportTicketsInput,
): Promise<ActionResult<ExportPayload>> {
    const actor = await getActor();
    if (!actor) return unauthorized<ExportPayload>();

    return exportTickets(actor, rawInput);
}
