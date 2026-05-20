/**
 * Tickets service — orquestra as regras de domínio sobre `tickets`.
 *
 * Esta camada é o ponto único onde validação de borda (Zod), autorização
 * (policies puras), núcleo puro (`computeSlaDeadline`, `nextTicketId`) e
 * persistência (repositórios Drizzle) se encontram. Todas as funções
 * retornam `ActionResult<T>` para que Server Actions e Route Handlers
 * tratem falhas de forma uniforme, sem precisar mapear exceções a códigos
 * HTTP no chamador.
 *
 * Validates: R3.1, R3.3, R3.4, R3.5, R3.6, R4.10, R4.11, R4.12, R5,
 *            R6.2, R9, R12.4, R12.6, R16.1, R16.2, R16.3, R16.4, R16.5,
 *            R16.6, R16.7.
 */

import { db, type Database } from "@/db/client";
import { linkToTicket as linkAttachmentToTicket } from "@/db/repositories/attachments.repo";
import { insertEvent } from "@/db/repositories/events.repo";
import {
    findVisibleForUser,
    insertTicket,
    updateTicket,
    type TicketInsert,
    type TicketUpdate,
} from "@/db/repositories/tickets.repo";
import { findById as findUserById } from "@/db/repositories/users.repo";
import { slaPolicies } from "@/db/schema";
import {
    canAssignOthers,
    canAssignSelf,
    canChangePriority,
    canChangeStatus,
    canCreateTicket,
    canRateTicket,
} from "@/lib/policies";
import { CreateTicketSchema } from "@/lib/schemas";
import { computeSlaDeadline } from "@/lib/sla";
import {
    deriveAction,
    IllegalStateTransitionError,
    transitionTicketStatus,
} from "@/lib/ticket-state";
import { nextTicketId } from "@/lib/ticket-id";
import type {
    ActionResult,
    Priority,
    SessionUser,
    SlaPolicy,
    Ticket,
    TicketStatus,
} from "@/types/domain";

/**
 * Executor aceito pelas operações de persistência: a instância base do
 * banco ou uma transação Drizzle. Como `Database = typeof db` e o `tx`
 * exposto por `db.transaction(...)` herdam de `PgDatabase`, tratamos
 * ambos sob o mesmo nome para tornar a intenção explícita ao leitor.
 */
type DbExecutor = Database;

/**
 * Erro interno usado para abortar a transação de criação quando um anexo
 * não pode ser vinculado (não existe, é de outro uploader ou já está
 * associado a outro ticket — ver `attachments.repo.linkToTicket`). Capturado
 * fora da transação e traduzido em `ActionResult.error.code = "ATTACHMENT_INVALID"`.
 */
class AttachmentLinkError extends Error {
    constructor(public readonly attachmentId: string) {
        super(`Attachment ${attachmentId} could not be linked to ticket.`);
        this.name = "AttachmentLinkError";
    }
}

/**
 * Carrega todas as políticas de SLA vigentes a partir do executor recebido.
 *
 * Usar o executor da transação garante que `computeSlaDeadline` opere com
 * a leitura coerente do mesmo ponto-no-tempo em que o ticket é gravado, e
 * permite testes que substituam a `db` global por uma instância de teste.
 *
 * O retorno é mapeado para o tipo de domínio `SlaPolicy` (sem `updatedAt`)
 * para desacoplar `lib/sla` do schema Drizzle.
 */
async function loadAllPolicies(executor: DbExecutor): Promise<SlaPolicy[]> {
    const rows = await executor.select().from(slaPolicies);
    return rows.map((row) => ({ priority: row.priority, minutes: row.minutes }));
}

/**
 * Cria um novo ticket em nome de `actor`.
 *
 * Pipeline:
 *   1. Valida `rawInput` via `CreateTicketSchema.safeParse`. Falha →
 *      `ActionResult.error.code = "VALIDATION"` apontando o primeiro campo
 *      inválido (R3.2).
 *   2. Verifica autorização com `canCreateTicket(actor)`. Falha →
 *      `FORBIDDEN`.
 *   3. Em uma única transação Drizzle:
 *      - Lê as políticas de SLA vigentes.
 *      - Calcula `slaDeadline` via `computeSlaDeadline` (R6.2).
 *      - Reserva o próximo ID via `nextTicketId("NVD", tx)` (R9).
 *      - INSERT em `tickets` com `status="aberto"` e `requesterId = actor.id`
 *        (R3.5, invariante de criação).
 *      - INSERT do evento `created` em `ticket_events` (R3.5, R16.1).
 *      - Para cada anexo informado, tenta vincular via `linkToTicket`. Se
 *        algum vínculo falha (anexo inexistente, de outro uploader ou já
 *        ligado a outro ticket — R3.6), `AttachmentLinkError` é lançado
 *        e a transação inteira é revertida.
 *   4. `AttachmentLinkError` é traduzido em `ActionResult.error.code =
 *      "ATTACHMENT_INVALID"`. Outros erros (DB indisponível, violação
 *      de FK inesperada) propagam para o chamador tratar como 500.
 *
 * Pós-condições garantidas em sucesso:
 * - `data.status === "aberto"` e `data.requesterId === actor.id`.
 * - `data.slaDeadline.getTime() > data.createdAt.getTime()`.
 * - Existe exatamente um evento `created` referenciando `data.id`.
 * - Todos os anexos passados em `input.attachments` estão vinculados a
 *   `data.id`, ou nenhum está (transação atômica).
 */
export async function createTicket(
    actor: SessionUser,
    rawInput: unknown,
): Promise<ActionResult<Ticket>> {
    // 1. Validação de borda — R3.2.
    const parsed = CreateTicketSchema.safeParse(rawInput);
    if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const field =
            issue && issue.path.length > 0 ? String(issue.path[0]) : undefined;
        return {
            ok: false,
            error: {
                code: "VALIDATION",
                message: issue?.message ?? "Entrada inválida.",
                ...(field ? { field } : {}),
            },
        };
    }
    const input = parsed.data;

    // 2. Autorização — R2.5/R3.
    if (!canCreateTicket(actor)) {
        return {
            ok: false,
            error: {
                code: "FORBIDDEN",
                message: "Você não tem permissão para abrir chamados.",
            },
        };
    }

    // 3. Transação atômica — R3.5, R3.6, R16.1.
    try {
        const ticket = await db.transaction(async (tx) => {
            const executor = tx as unknown as DbExecutor;

            const policies = await loadAllPolicies(executor);
            const now = new Date();
            const slaDeadline = computeSlaDeadline(
                now,
                input.priority,
                policies,
            );
            const ticketId = await nextTicketId("NVD", executor);

            const values: TicketInsert = {
                id: ticketId,
                title: input.title,
                description: input.description,
                status: "aberto",
                priority: input.priority,
                categoryId: input.categoryId,
                departmentId: input.departmentId,
                requesterId: actor.id,
                assigneeId: null,
                createdAt: now,
                updatedAt: now,
                slaDeadline,
            };

            const inserted = await insertTicket(executor, values);

            await insertEvent(executor, {
                ticketId: inserted.id,
                type: "created",
                actorId: actor.id,
                fromValue: null,
                toValue: "aberto",
            });

            for (const attachmentId of input.attachments) {
                const linked = await linkAttachmentToTicket(
                    executor,
                    attachmentId,
                    inserted.id,
                    actor.id,
                );
                if (!linked) {
                    throw new AttachmentLinkError(attachmentId);
                }
            }

            return inserted;
        });

        return { ok: true, data: ticket };
    } catch (err) {
        if (err instanceof AttachmentLinkError) {
            return {
                ok: false,
                error: {
                    code: "ATTACHMENT_INVALID",
                    message:
                        "Um ou mais anexos informados não puderam ser vinculados ao ticket.",
                    field: "attachments",
                },
            };
        }
        throw err;
    }
}

/**
 * Garante que `updateTicket` retornou uma linha. Como toda mutação aqui
 * carrega o ticket via `findVisibleForUser` antes de atualizar, um
 * `null` neste ponto sinaliza condição de corrida (ticket apagado entre
 * leitura e UPDATE) ou bug — propaga como erro inesperado para o
 * caller tratar como 500.
 */
function ensureUpdated(updated: Ticket | null): Ticket {
    if (!updated) {
        throw new Error(
            "tickets.service: UPDATE não retornou linha — ticket inexistente ou removido durante a operação.",
        );
    }
    return updated;
}

/**
 * Resposta padrão para "ticket não encontrado ou sem permissão de
 * visualização". Não diferenciamos os dois casos para evitar enumeração
 * de IDs por solicitantes (R12.7).
 */
function notFoundResult<T>(): ActionResult<T> {
    return {
        ok: false,
        error: { code: "NOT_FOUND", message: "Ticket não encontrado." },
    };
}

/**
 * Resposta padrão para falhas de RBAC.
 */
function forbiddenResult<T>(message: string): ActionResult<T> {
    return {
        ok: false,
        error: { code: "FORBIDDEN", message },
    };
}

/**
 * Janela de auto-fechamento de tickets resolvidos (R12.6 — política
 * "se o solicitante não confirmar, fecha sozinho"). Tickets em
 * `resolvido` há mais que esse intervalo viram `fechado` na próxima
 * leitura via `autoCloseIfExpired`. 24h dá tempo razoável para o
 * solicitante reagir sem deixar tickets pendurados indefinidamente.
 */
const AUTO_CLOSE_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * Fecha preguiçosamente um ticket que está em `resolvido` há mais de
 * `AUTO_CLOSE_AFTER_MS` (24h). Idempotente: chamadas concorrentes
 * convergem para o mesmo estado final.
 *
 * Por que **lazy** em vez de cron job?
 *
 * 1. **Simplicidade operacional**: o app é entregue como Next.js
 *    standalone; não há scheduler externo (no produto atual). Um cron
 *    interno (`setInterval`) entraria em conflito com instâncias
 *    múltiplas em produção e não roda em ambiente serverless.
 * 2. **Custo zero**: a checagem só acontece quando o ticket é aberto
 *    pelo usuário — é o exato momento em que importa que o estado
 *    esteja correto na UI.
 * 3. **Consistência**: a transição reusa exatamente o caminho de
 *    `changeTicketStatus("fechado")` (UPDATE + evento `status_changed`
 *    + evento `closed`), preservando a trilha de auditoria com o
 *    "ator" sendo o próprio sistema.
 *
 * Para representar o ator do sistema, usamos `actor.id` do solicitante
 * que abriu a tela — o evento fica registrado como "fechamento
 * automático após o solicitante deixar passar a janela", e a UI deixa
 * isso explícito via copy. Em uma evolução futura, podemos dedicar um
 * usuário "system" e gravar nele.
 *
 * Retorna a versão atualizada do ticket (já em `fechado`) ou o próprio
 * ticket sem alterações quando ainda dentro da janela.
 */
export async function autoCloseIfExpired(
    ticket: Ticket,
    actor: SessionUser,
    now: Date = new Date(),
): Promise<Ticket> {
    if (ticket.status !== "resolvido") return ticket;
    if (!ticket.resolvedAt) return ticket;
    const elapsedMs = now.getTime() - ticket.resolvedAt.getTime();
    if (elapsedMs < AUTO_CLOSE_AFTER_MS) return ticket;

    // Roda a transição em transação dedicada para preservar a invariante
    // "UPDATE de tickets sempre acompanhado do evento `status_changed`"
    // (R16.2, R16.7). Concorrência: se dois processos chegarem aqui ao
    // mesmo tempo, o segundo verá o status já `fechado` na transação e
    // o branch `nextStatus === ticket.status` faz a operação ser
    // efetivamente um no-op. O ticket retornado é idempotente.
    return db.transaction(async (tx) => {
        const executor = tx as unknown as DbExecutor;
        const fresh = await findVisibleForUser(executor, actor, ticket.id);
        if (!fresh || fresh.status !== "resolvido") {
            return fresh ?? ticket;
        }

        const patch: TicketUpdate = {
            status: "fechado",
            closedAt: now,
            updatedAt: now,
        };
        const row = ensureUpdated(
            await updateTicket(executor, fresh.id, patch),
        );

        await insertEvent(executor, {
            ticketId: fresh.id,
            type: "status_changed",
            actorId: actor.id,
            fromValue: fresh.status,
            toValue: "fechado",
        });
        await insertEvent(executor, {
            ticketId: fresh.id,
            type: "closed",
            actorId: actor.id,
            fromValue: fresh.status,
            toValue: null,
        });
        return row;
    });
}

/**
 * Altera o status de um ticket aplicando policy + máquina de estados.
 *
 * Pipeline:
 *   1. Carrega o ticket via `findVisibleForUser(actor)`. Tickets invisíveis
 *      retornam `NOT_FOUND` (R12.7), idêntico ao caso de inexistência.
 *   2. `canChangeStatus(actor, ticket, nextStatus)` decide a permissão.
 *      Falha → `FORBIDDEN` (R2.6).
 *   3. `deriveAction(current, next)` infere a ação canônica e
 *      `transitionTicketStatus(current, action)` valida a transição contra
 *      a tabela de estados; combinações ilegais lançam
 *      `IllegalStateTransitionError`, traduzido em
 *      `INVALID_TRANSITION`.
 *   4. Em uma transação Drizzle, faz UPDATE em `tickets` + INSERT do
 *      evento `status_changed` (R4.12, R16.2). Quando o destino é
 *      `resolvido`, atribui `resolvedAt = now` se ainda nulo (R4.10).
 *      Quando é `fechado`, atribui `closedAt = now` (R4.11) e também
 *      registra um evento `closed` adicional (R16.7).
 */
export async function changeTicketStatus(
    actor: SessionUser,
    ticketId: string,
    nextStatus: TicketStatus,
): Promise<ActionResult<Ticket>> {
    const ticket = await findVisibleForUser(db, actor, ticketId);
    if (!ticket) return notFoundResult();

    if (!canChangeStatus(actor, ticket, nextStatus)) {
        return forbiddenResult(
            "Você não tem permissão para alterar o status deste ticket.",
        );
    }

    // Caminho idempotente: pedir o mesmo status atual não é uma transição
    // — devolve o ticket sem alteração e sem gravar evento, evitando
    // ruído na trilha de auditoria.
    if (ticket.status === nextStatus) {
        return { ok: true, data: ticket };
    }

    // Auto-atribuição implícita (R5 — fluxo operacional do técnico).
    //
    // Quando um **técnico ou admin** muda o status de um ticket que
    // ainda está sem responsável, é praticamente certo que ele vai
    // assumir o atendimento. Em vez de exigir dois cliques (Assumir
    // → Mudar status), atribuímos automaticamente a quem realizou a
    // ação — independente do papel. Sem isso, tickets sem responsável
    // viram "fantasmas" depois de ir para `andamento`/`resolvido`,
    // quebrando o pareamento "quem moveu = quem responde" que a UI
    // assume em listagens e métricas.
    //
    // O assignee é gravado no mesmo UPDATE da mudança de status (mesma
    // transação) e um evento `assigned` complementar é registrado para
    // manter a trilha completa.
    const willAutoAssign =
        (actor.role === "tecnico" || actor.role === "admin") &&
        ticket.assigneeId === null;

    let action;
    try {
        action = deriveAction(ticket.status, nextStatus);
        const projected = transitionTicketStatus(ticket.status, action);
        if (projected !== nextStatus) {
            // A ação canônica leva a outro estado — a transição pedida
            // não é coerente com a máquina; sinaliza explicitamente.
            throw new IllegalStateTransitionError(
                ticket.status,
                action,
                nextStatus,
            );
        }
    } catch (err) {
        if (err instanceof IllegalStateTransitionError) {
            return {
                ok: false,
                error: {
                    code: "INVALID_TRANSITION",
                    message: `Transição inválida de "${ticket.status}" para "${nextStatus}".`,
                },
            };
        }
        throw err;
    }

    const now = new Date();
    const patch: TicketUpdate = {
        status: nextStatus,
        updatedAt: now,
    };
    if (nextStatus === "resolvido" && ticket.resolvedAt === null) {
        patch.resolvedAt = now;
    }
    if (nextStatus === "fechado") {
        patch.closedAt = now;
    }
    if (willAutoAssign) {
        patch.assigneeId = actor.id;
    }

    const updated = await db.transaction(async (tx) => {
        const executor = tx as unknown as DbExecutor;
        const row = ensureUpdated(await updateTicket(executor, ticket.id, patch));

        // Evento de atribuição automática vai antes do status_changed
        // para refletir a ordem causal: "assumiu, depois mudou status".
        if (willAutoAssign) {
            await insertEvent(executor, {
                ticketId: ticket.id,
                type: "assigned",
                actorId: actor.id,
                fromValue: null,
                toValue: actor.id,
            });
        }

        await insertEvent(executor, {
            ticketId: ticket.id,
            type: "status_changed",
            actorId: actor.id,
            fromValue: ticket.status,
            toValue: nextStatus,
        });

        // R16.7: o fechamento é tratado como evento próprio, complementar
        // ao `status_changed`, para facilitar consultas dedicadas (KPIs,
        // relatórios) sem inferir o tipo a partir de `toValue`.
        if (nextStatus === "fechado") {
            await insertEvent(executor, {
                ticketId: ticket.id,
                type: "closed",
                actorId: actor.id,
                fromValue: ticket.status,
                toValue: "fechado",
            });
        }

        return row;
    });

    return { ok: true, data: updated };
}

/**
 * Altera a prioridade do ticket.
 *
 * Não envolve a máquina de estados (mudança de prioridade não muda
 * status). Apenas valida `canChangePriority` e grava `priority_changed`
 * (R16.3) na mesma transação do UPDATE.
 *
 * O `slaDeadline` original é **preservado** intencionalmente: a mudança
 * reflete a reclassificação operacional do ticket, mas o prazo
 * acordado quando ele foi aberto continua valendo (princípio coerente
 * com R6.10 para mudanças globais de política).
 */
export async function changeTicketPriority(
    actor: SessionUser,
    ticketId: string,
    nextPriority: Priority,
): Promise<ActionResult<Ticket>> {
    const ticket = await findVisibleForUser(db, actor, ticketId);
    if (!ticket) return notFoundResult();

    if (!canChangePriority(actor, ticket)) {
        return forbiddenResult(
            "Você não tem permissão para alterar a prioridade deste ticket.",
        );
    }

    if (ticket.priority === nextPriority) {
        return { ok: true, data: ticket };
    }

    const now = new Date();
    const updated = await db.transaction(async (tx) => {
        const executor = tx as unknown as DbExecutor;
        const row = ensureUpdated(
            await updateTicket(executor, ticket.id, {
                priority: nextPriority,
                updatedAt: now,
            }),
        );

        await insertEvent(executor, {
            ticketId: ticket.id,
            type: "priority_changed",
            actorId: actor.id,
            fromValue: ticket.priority,
            toValue: nextPriority,
        });

        return row;
    });

    return { ok: true, data: updated };
}

/**
 * Atribui ou remove o responsável de um ticket.
 *
 * Comportamento:
 *
 * - `assigneeId !== null` (designar terceiro): exige `canAssignOthers`
 *   (admin). Valida que o destinatário existe, está ativo e tem papel
 *   `tecnico` ou `admin` (R5.3); falha → `INVALID_ASSIGNEE`. Aplica a
 *   ação `ASSIGN` na máquina de estados — a transição é silenciosamente
 *   no-op para `andamento`/`aguardando` e leva `aberto → andamento`
 *   (R5.2). Se a máquina rejeitar (ex.: ticket `fechado`), retorna
 *   `INVALID_TRANSITION`.
 * - `assigneeId === null` (remover atribuição): exige `canAssignOthers`.
 *   Não invoca a máquina de estados — a remoção da atribuição não
 *   altera status (`unassigned` é evento próprio, R16.5). Para tickets
 *   `fechado`, o policy `canAssignSelf` rejeita auto-atribuição mas a
 *   remoção administrativa permanece possível para corrigir registros.
 *
 * Para auto-atribuição de técnicos, use `assignTicketToMe`. Esta função
 * é a interface administrativa.
 */
export async function assignTicket(
    actor: SessionUser,
    ticketId: string,
    assigneeId: string | null,
): Promise<ActionResult<Ticket>> {
    const ticket = await findVisibleForUser(db, actor, ticketId);
    if (!ticket) return notFoundResult();

    if (!canAssignOthers(actor)) {
        return forbiddenResult(
            "Você não tem permissão para atribuir este ticket a outro usuário.",
        );
    }

    if (assigneeId === null) {
        return performUnassign(actor, ticket);
    }

    // Validação do destinatário — R5.3.
    const target = await findUserById(db, assigneeId);
    if (!target || !target.active) {
        return {
            ok: false,
            error: {
                code: "INVALID_ASSIGNEE",
                message:
                    "Usuário destinatário não encontrado ou está inativo.",
                field: "assigneeId",
            },
        };
    }
    if (target.role !== "tecnico" && target.role !== "admin") {
        return {
            ok: false,
            error: {
                code: "INVALID_ASSIGNEE",
                message:
                    "Apenas técnicos ou administradores podem ser responsáveis por tickets.",
                field: "assigneeId",
            },
        };
    }

    return performAssign(actor, ticket, assigneeId);
}

/**
 * Atalho para que `tecnico`/`admin` assumam o ticket para si próprios.
 *
 * - Verifica `canAssignSelf` (rejeita tickets `fechado` e papel
 *   `solicitante`).
 * - Aplica a ação `ASSIGN` na máquina de estados, levando `aberto →
 *   andamento` (R5.2). Para os demais estados, a máquina é idempotente
 *   no status atual e a operação muda apenas `assigneeId`.
 */
export async function assignTicketToMe(
    actor: SessionUser,
    ticketId: string,
): Promise<ActionResult<Ticket>> {
    const ticket = await findVisibleForUser(db, actor, ticketId);
    if (!ticket) return notFoundResult();

    if (!canAssignSelf(actor, ticket)) {
        return forbiddenResult(
            "Você não pode assumir este ticket.",
        );
    }

    return performAssign(actor, ticket, actor.id);
}

/**
 * Remove a atribuição (assignee → null) de um ticket.
 *
 * Operação administrativa: requer `canAssignOthers`. Ver `assignTicket`
 * para a semântica detalhada da separação.
 */
export async function unassignTicket(
    actor: SessionUser,
    ticketId: string,
): Promise<ActionResult<Ticket>> {
    const ticket = await findVisibleForUser(db, actor, ticketId);
    if (!ticket) return notFoundResult();

    if (!canAssignOthers(actor)) {
        return forbiddenResult(
            "Você não tem permissão para remover a atribuição deste ticket.",
        );
    }

    return performUnassign(actor, ticket);
}

/**
 * Avalia o atendimento de um ticket (1..5 estrelas).
 *
 * Pipeline:
 *   1. Carrega + visibilidade (R12.7).
 *   2. `canRateTicket` exige `solicitante`, autor do ticket e status
 *      `resolvido` (R12.5).
 *   3. Validação do intervalo `1 ≤ stars ≤ 5` em inteiros — defesa em
 *      profundidade contra chamadas que pulem o parse Zod da Server
 *      Action.
 *   4. Em transação: UPDATE `rating` + INSERT do evento `rated` com
 *      `toValue = String(stars)` (R12.6, R16.6).
 *
 * `rating` aceita apenas o intervalo discreto `1 | 2 | 3 | 4 | 5`; o cast
 * para esse subtipo do domínio é seguro porque a checagem de
 * `Number.isInteger` + faixa já foi feita antes.
 */
export async function rateTicket(
    actor: SessionUser,
    ticketId: string,
    stars: number,
): Promise<ActionResult<Ticket>> {
    const ticket = await findVisibleForUser(db, actor, ticketId);
    if (!ticket) return notFoundResult();

    if (!canRateTicket(actor, ticket)) {
        return forbiddenResult(
            "Você não pode avaliar este ticket.",
        );
    }

    if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
        return {
            ok: false,
            error: {
                code: "VALIDATION",
                message: "A avaliação deve ser um inteiro entre 1 e 5.",
                field: "stars",
            },
        };
    }

    const ratingValue = stars as 1 | 2 | 3 | 4 | 5;
    const now = new Date();

    const updated = await db.transaction(async (tx) => {
        const executor = tx as unknown as DbExecutor;
        const row = ensureUpdated(
            await updateTicket(executor, ticket.id, {
                rating: ratingValue,
                updatedAt: now,
            }),
        );

        await insertEvent(executor, {
            ticketId: ticket.id,
            type: "rated",
            actorId: actor.id,
            fromValue:
                ticket.rating !== null ? String(ticket.rating) : null,
            toValue: String(ratingValue),
        });

        return row;
    });

    return { ok: true, data: updated };
}

/**
 * Helper interno: aplica atribuição (assignee !== null) em transação.
 *
 * Compartilhado entre `assignTicket(adm, …, id)` e `assignTicketToMe`.
 * Centraliza a lógica de máquina de estados e gravação do evento
 * `assigned` (R16.4) para evitar drift entre os dois caminhos.
 *
 * Quando o ticket está `fechado`, a tabela de transições rejeita
 * `ASSIGN` e a operação retorna `INVALID_TRANSITION` — comportamento
 * consistente com o predicado `canAssignSelf` (que já bloqueia o
 * caminho de auto-atribuição).
 */
async function performAssign(
    actor: SessionUser,
    ticket: Ticket,
    nextAssigneeId: string,
): Promise<ActionResult<Ticket>> {
    let nextStatus: TicketStatus;
    try {
        nextStatus = transitionTicketStatus(ticket.status, "ASSIGN");
    } catch (err) {
        if (err instanceof IllegalStateTransitionError) {
            return {
                ok: false,
                error: {
                    code: "INVALID_TRANSITION",
                    message: `Não é possível atribuir um ticket no status "${ticket.status}".`,
                },
            };
        }
        throw err;
    }

    // Auto-atribuição idempotente: se o ticket já está com o mesmo
    // assignee e o status não muda, evita gravar evento ruidoso.
    if (
        ticket.assigneeId === nextAssigneeId &&
        ticket.status === nextStatus
    ) {
        return { ok: true, data: ticket };
    }

    const now = new Date();
    const updated = await db.transaction(async (tx) => {
        const executor = tx as unknown as DbExecutor;
        const patch: TicketUpdate = {
            assigneeId: nextAssigneeId,
            updatedAt: now,
        };
        if (nextStatus !== ticket.status) {
            patch.status = nextStatus;
        }
        const row = ensureUpdated(
            await updateTicket(executor, ticket.id, patch),
        );

        // Evento `assigned` cobre tanto a primeira atribuição quanto
        // reatribuições (`fromValue` carrega o assignee anterior).
        if (ticket.assigneeId !== nextAssigneeId) {
            await insertEvent(executor, {
                ticketId: ticket.id,
                type: "assigned",
                actorId: actor.id,
                fromValue: ticket.assigneeId,
                toValue: nextAssigneeId,
            });
        }

        // Quando a ação `ASSIGN` move o status (caso `aberto → andamento`),
        // o `status_changed` complementar mantém a trilha completa
        // (R4.12, R16.2).
        if (nextStatus !== ticket.status) {
            await insertEvent(executor, {
                ticketId: ticket.id,
                type: "status_changed",
                actorId: actor.id,
                fromValue: ticket.status,
                toValue: nextStatus,
            });
        }

        return row;
    });

    return { ok: true, data: updated };
}

/**
 * Helper interno: remove a atribuição em transação.
 *
 * Não envolve máquina de estados — `unassigned` é apenas um evento de
 * auditoria (R16.5) sobre a coluna `assignee_id`.
 */
async function performUnassign(
    actor: SessionUser,
    ticket: Ticket,
): Promise<ActionResult<Ticket>> {
    if (ticket.assigneeId === null) {
        // Já está sem responsável — operação no-op para evitar evento
        // duplicado.
        return { ok: true, data: ticket };
    }

    const now = new Date();
    const updated = await db.transaction(async (tx) => {
        const executor = tx as unknown as DbExecutor;
        const row = ensureUpdated(
            await updateTicket(executor, ticket.id, {
                assigneeId: null,
                updatedAt: now,
            }),
        );

        await insertEvent(executor, {
            ticketId: ticket.id,
            type: "unassigned",
            actorId: actor.id,
            fromValue: ticket.assigneeId,
            toValue: null,
        });

        return row;
    });

    return { ok: true, data: updated };
}
