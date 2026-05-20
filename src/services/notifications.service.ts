/**
 * Notifications service — orquestra fan-out e leitura de notificações.
 *
 * Esta camada é o **único ponto** que sabe como traduzir um evento de
 * domínio (ticket criado, mensagem postada, status alterado) em uma
 * lista de notificações dirigidas. Os serviços de domínio (`tickets`,
 * `messages`) chamam funções daqui dentro das suas próprias transações,
 * passando o executor (`tx`) para que tudo seja atômico — o
 * banco fica em estado consistente "ou tudo se compromete, ou nada".
 *
 * Regras de fan-out (resumo):
 *
 * - **Ticket criado**: notifica todos os técnicos e admins ativos
 *   exceto o autor. Recurso útil enquanto a fila não tem owner.
 * - **Status alterado / prioridade alterada / atribuição**: notifica
 *   o assignee atual e o requester (exceto o ator que disparou).
 * - **Mensagem pública**: notifica a "outra ponta" da conversa —
 *   se o autor é o solicitante, vai para o assignee; se o autor é
 *   técnico/admin, vai para o solicitante.
 * - **Nota interna**: notifica apenas o assignee atual (se diferente
 *   do autor) — solicitantes nunca recebem notas internas.
 *
 * As funções recebem o `executor` para serem invocadas dentro da
 * transação que gerou o evento, evitando estados parciais (ticket
 * criado mas sem notificações, ou notificação fantasma de algo que
 * deu rollback).
 *
 * Os erros do `insertNotifications` propagam — fan-out é parte do
 * caminho crítico da operação.
 */

import { eq } from "drizzle-orm";

import { db, type Database } from "@/db/client";
import {
    countUnread as repoCountUnread,
    insertNotifications,
    listForUser as repoListForUser,
    markAllRead as repoMarkAllRead,
    type NotificationCursor,
    type NotificationInsert,
    type NotificationPage,
} from "@/db/repositories/notifications.repo";
import { listByRoles } from "@/db/repositories/users.repo";
import { users } from "@/db/schema";
import type { Priority, SessionUser, Ticket, TicketStatus } from "@/types/domain";

/** Tipo enxuto que representa o executor — `db` ou um `tx`. */
type DbExecutor = Database;

/** Resolve o nome do ator (para usar no corpo da notificação). */
async function resolveActorName(
    executor: DbExecutor,
    actorId: string,
): Promise<string> {
    const rows = await executor
        .select({ name: users.name })
        .from(users)
        .where(eq(users.id, actorId))
        .limit(1);
    return rows[0]?.name ?? "Alguém";
}

/**
 * Fan-out na criação de ticket: notifica todos os técnicos e admins
 * ativos (exceto o próprio autor, caso seja um técnico que abriu para
 * si mesmo).
 *
 * Inclui o `Ticket` na assinatura para que possamos compor o título
 * com o ID legível (`NVD-XXXX`) e a primeira linha do título.
 */
export async function notifyTicketCreated(
    executor: DbExecutor,
    ticket: Ticket,
    actor: SessionUser,
): Promise<void> {
    const recipients = await listByRoles(executor, ["tecnico", "admin"]);
    const targets = recipients.filter((u) => u.id !== actor.id);
    if (targets.length === 0) return;

    const rows: NotificationInsert[] = targets.map((u) => ({
        userId: u.id,
        ticketId: ticket.id,
        type: "ticket_created",
        title: `Novo chamado: ${ticket.id}`,
        body: `${actor.name} abriu "${ticket.title}".`,
        actorId: actor.id,
    }));

    await insertNotifications(executor, rows);
}

/**
 * Fan-out na mudança de status. Notifica o assignee atual e o
 * requester, ambos diferentes do ator.
 *
 * `previousStatus` é importante para distinguir "Resolvido" e
 * "Fechado" no copy. `nextStatus === "resolvido"` gera
 * `ticket_resolved` (mais saliente para o solicitante avaliar);
 * `fechado` gera `ticket_closed`; demais transições usam o tipo
 * genérico `ticket_status_changed`.
 */
export async function notifyTicketStatusChanged(
    executor: DbExecutor,
    ticket: Ticket,
    actor: SessionUser,
    previousStatus: TicketStatus,
    nextStatus: TicketStatus,
): Promise<void> {
    const targets = collectTicketParties(ticket, actor.id);
    if (targets.length === 0) return;

    const type =
        nextStatus === "resolvido"
            ? "ticket_resolved"
            : nextStatus === "fechado"
                ? "ticket_closed"
                : "ticket_status_changed";

    const statusLabel = STATUS_LABELS_PT[nextStatus] ?? nextStatus;
    const title = `${ticket.id}: ${statusLabel}`;
    const body = `${actor.name} alterou o status de "${STATUS_LABELS_PT[previousStatus] ?? previousStatus}" para "${statusLabel}".`;

    const rows: NotificationInsert[] = targets.map((userId) => ({
        userId,
        ticketId: ticket.id,
        type,
        title,
        body,
        actorId: actor.id,
    }));

    await insertNotifications(executor, rows);
}

/**
 * Fan-out na mudança de prioridade.
 */
export async function notifyTicketPriorityChanged(
    executor: DbExecutor,
    ticket: Ticket,
    actor: SessionUser,
    previousPriority: Priority,
    nextPriority: Priority,
): Promise<void> {
    const targets = collectTicketParties(ticket, actor.id);
    if (targets.length === 0) return;

    const previousLabel =
        PRIORITY_LABELS_PT[previousPriority] ?? previousPriority;
    const nextLabel = PRIORITY_LABELS_PT[nextPriority] ?? nextPriority;

    const rows: NotificationInsert[] = targets.map((userId) => ({
        userId,
        ticketId: ticket.id,
        type: "ticket_priority_changed",
        title: `${ticket.id}: prioridade ${nextLabel}`,
        body: `${actor.name} alterou a prioridade de "${previousLabel}" para "${nextLabel}".`,
        actorId: actor.id,
    }));

    await insertNotifications(executor, rows);
}

/**
 * Fan-out de atribuição. Notifica o **novo assignee** (quando ele não
 * é o próprio ator — isto é, quando alguém atribuiu o ticket a outra
 * pessoa) e o requester (sempre, exceto se for o ator).
 *
 * Para auto-atribuição (`actor.id === newAssigneeId`), o novo assignee
 * é o próprio ator e não recebe notificação — apenas o requester.
 */
export async function notifyTicketAssigned(
    executor: DbExecutor,
    ticket: Ticket,
    actor: SessionUser,
    newAssigneeId: string,
): Promise<void> {
    const set = new Set<string>();
    if (newAssigneeId !== actor.id) set.add(newAssigneeId);
    if (ticket.requesterId !== actor.id) set.add(ticket.requesterId);
    set.delete(actor.id);

    if (set.size === 0) return;

    const rows: NotificationInsert[] = Array.from(set).map((userId) => ({
        userId,
        ticketId: ticket.id,
        type: "ticket_assigned" as const,
        title: `${ticket.id}: atribuído`,
        body:
            userId === newAssigneeId
                ? `${actor.name} atribuiu este chamado a você.`
                : `${actor.name} atribuiu o chamado a um responsável.`,
        actorId: actor.id,
    }));

    await insertNotifications(executor, rows);
}

/**
 * Fan-out de remoção de atribuição. Notifica o assignee anterior
 * (se diferente do ator) e o requester.
 */
export async function notifyTicketUnassigned(
    executor: DbExecutor,
    ticket: Ticket,
    actor: SessionUser,
    previousAssigneeId: string,
): Promise<void> {
    const set = new Set<string>();
    if (previousAssigneeId !== actor.id) set.add(previousAssigneeId);
    if (ticket.requesterId !== actor.id) set.add(ticket.requesterId);
    set.delete(actor.id);

    if (set.size === 0) return;

    const rows: NotificationInsert[] = Array.from(set).map((userId) => ({
        userId,
        ticketId: ticket.id,
        type: "ticket_unassigned" as const,
        title: `${ticket.id}: sem responsável`,
        body: `${actor.name} removeu o responsável do chamado.`,
        actorId: actor.id,
    }));

    await insertNotifications(executor, rows);
}

/**
 * Fan-out de mensagem pública. Notifica a "outra ponta" da conversa:
 * se o autor é o solicitante, vai para o assignee atual; se é
 * técnico/admin, vai para o solicitante.
 *
 * Quando ambos são técnicos/admins (ex.: técnico A respondendo num
 * ticket de outro técnico), notifica o requester apenas.
 */
export async function notifyMessagePosted(
    executor: DbExecutor,
    ticket: Ticket,
    actor: SessionUser,
    isInternal: boolean,
    bodyExcerpt: string,
): Promise<void> {
    const targets = new Set<string>();

    if (isInternal) {
        // Notas internas vão apenas para o assignee atual (se diferente
        // do autor). Solicitantes nunca recebem notas internas.
        if (ticket.assigneeId && ticket.assigneeId !== actor.id) {
            targets.add(ticket.assigneeId);
        }
    } else {
        // Mensagem pública: notifica a contraparte apropriada.
        if (actor.id === ticket.requesterId) {
            // Solicitante respondeu — avisa o assignee.
            if (ticket.assigneeId && ticket.assigneeId !== actor.id) {
                targets.add(ticket.assigneeId);
            }
        } else {
            // Técnico/admin respondeu — avisa o solicitante.
            if (ticket.requesterId !== actor.id) {
                targets.add(ticket.requesterId);
            }
        }
    }

    if (targets.size === 0) return;

    const type = isInternal ? "message_internal" : "message_public";
    const titlePrefix = isInternal ? "Nota interna" : "Nova mensagem";
    const title = `${ticket.id}: ${titlePrefix}`;
    const body = `${actor.name}: ${truncate(bodyExcerpt, 140)}`;

    const rows: NotificationInsert[] = Array.from(targets).map((userId) => ({
        userId,
        ticketId: ticket.id,
        type,
        title,
        body,
        actorId: actor.id,
    }));

    await insertNotifications(executor, rows);
}

/**
 * Fan-out de avaliação. Notifica o assignee de que o atendimento foi
 * avaliado. Não notifica o requester (que é o próprio ator).
 */
export async function notifyTicketRated(
    executor: DbExecutor,
    ticket: Ticket,
    actor: SessionUser,
    stars: number,
): Promise<void> {
    if (!ticket.assigneeId || ticket.assigneeId === actor.id) return;

    await insertNotifications(executor, [
        {
            userId: ticket.assigneeId,
            ticketId: ticket.id,
            type: "ticket_rated",
            title: `${ticket.id}: avaliação ${stars} ⭐`,
            body: `${actor.name} avaliou o atendimento com ${stars} ${
                stars === 1 ? "estrela" : "estrelas"
            }.`,
            actorId: actor.id,
        },
    ]);
}

// ---------------------------------------------------------------------------
// Leitura (consumido pela UI)
// ---------------------------------------------------------------------------

/** Conta notificações não-lidas do usuário. */
export async function countUnread(userId: string): Promise<number> {
    return repoCountUnread(db, userId);
}

/** Lista notificações do usuário paginadas (mais recentes primeiro). */
export async function listForUser(
    userId: string,
    opts: { cursor?: NotificationCursor; limit?: number } = {},
): Promise<NotificationPage> {
    return repoListForUser(db, userId, opts);
}

/** Marca todas as não-lidas como lidas. Idempotente. */
export async function markAllRead(userId: string): Promise<number> {
    return repoMarkAllRead(db, userId);
}

// ---------------------------------------------------------------------------
// Helpers privados
// ---------------------------------------------------------------------------

/**
 * Reúne os IDs do requester e do assignee atual, removendo o ator
 * para evitar auto-notificação. Retorna lista deduplicada.
 */
function collectTicketParties(ticket: Ticket, actorId: string): string[] {
    const set = new Set<string>();
    if (ticket.requesterId !== actorId) set.add(ticket.requesterId);
    if (ticket.assigneeId && ticket.assigneeId !== actorId) {
        set.add(ticket.assigneeId);
    }
    return Array.from(set);
}

/** Trunca uma string para uso no `body` da notificação. */
function truncate(input: string, max: number): string {
    if (input.length <= max) return input;
    return input.slice(0, max - 1).trimEnd() + "…";
}

/** Rótulos pt-BR de status (replica `lib/constants` evitando dependência circular). */
const STATUS_LABELS_PT: Record<TicketStatus, string> = {
    aberto: "Aberto",
    andamento: "Em andamento",
    aguardando: "Aguardando solicitante",
    resolvido: "Resolvido",
    fechado: "Fechado",
};

/** Rótulos pt-BR de prioridade. */
const PRIORITY_LABELS_PT: Record<Priority, string> = {
    baixa: "Baixa",
    media: "Média",
    alta: "Alta",
    critica: "Crítica",
};
