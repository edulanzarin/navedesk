/**
 * Messages service — orquestra a conversa pública e as notas internas em tickets.
 *
 * Esta camada concentra a lógica de RBAC e persistência de mensagens
 * (`ticket_messages`), garantindo que:
 *
 * - Solicitantes só conversem em tickets de sua própria autoria
 *   (defesa em profundidade sobre `canViewTicket`).
 * - Apenas `tecnico`/`admin` postem `Notas_Internas` (`isInternal=true`),
 *   enquanto solicitantes ficam restritos a mensagens públicas.
 * - A leitura da conversa esconda notas internas para solicitantes,
 *   delegando o filtro ao SQL via `listMessagesForTicket(includeInternal)`.
 *
 * Os erros tratáveis são devolvidos como `ActionResult.error` com códigos
 * estáveis (`NOT_FOUND`, `FORBIDDEN`); falhas inesperadas do driver
 * (constraint violation, queda de conexão) propagam como exceção para o
 * caller mapear em telemetria/HTTP 500.
 *
 * Validates: R7.1, R7.2, R7.3, R7.4, R7.5, R7.8.
 */

import { db } from "@/db/client";
import {
    insertMessage,
    listMessagesForTicket,
    type MessageRow,
} from "@/db/repositories/messages.repo";
import { findTicketById } from "@/db/repositories/tickets.repo";
import { canPostInternalNote, canViewTicket } from "@/lib/policies";
import { type PostMessageInput } from "@/lib/schemas";
import { notifyMessagePosted } from "@/services/notifications.service";
import type { ActionResult, SessionUser } from "@/types/domain";

/**
 * Posta uma mensagem (pública ou nota interna) em um ticket.
 *
 * O fluxo executado:
 *
 * 1. Carrega o ticket via `findTicketById`. Quando o ticket não existe ou
 *    o `actor` não pode visualizá-lo (`canViewTicket=false`), retorna
 *    `NOT_FOUND` — nunca diferenciamos "não existe" de "sem acesso" para
 *    evitar enumeração de IDs por solicitantes (R7.4 + R12.7).
 * 2. Quando `isInternal=true`, valida `canPostInternalNote`. Solicitantes
 *    são rejeitados com `FORBIDDEN` (R7.3); a UI já oculta o toggle, mas
 *    a borda revalida porque a chamada pode chegar via Server Action
 *    direta.
 * 3. Insere a mensagem com `authorId=actor.id`. `createdAt` é gerado pelo
 *    Postgres (`defaultNow()`), mantendo o timestamp consistente entre
 *    réplicas e independente do clock do servidor Node.
 *
 * O `input` chega já validado (parse Zod feito na Server Action), por
 * isso recebemos `PostMessageInput` em vez de re-parsear aqui — esta
 * camada **confia no contrato** de quem chama.
 *
 * Validates: R7.1, R7.2, R7.3, R7.4.
 */
export async function postMessage(
    actor: SessionUser,
    ticketId: string,
    input: PostMessageInput,
): Promise<ActionResult<MessageRow>> {
    const ticket = await findTicketById(db, ticketId);
    if (!ticket || !canViewTicket(actor, ticket)) {
        return {
            ok: false,
            error: {
                code: "NOT_FOUND",
                message: "Ticket não encontrado.",
            },
        };
    }

    if (input.isInternal && !canPostInternalNote(actor)) {
        return {
            ok: false,
            error: {
                code: "FORBIDDEN",
                message: "Você não pode postar notas internas neste ticket.",
            },
        };
    }

    // R7.10 / R12.5 — quando o ticket sai do ciclo ativo, restringimos
    // o que pode ser postado:
    //
    //   - `fechado`: nenhuma mensagem nova (nem mesmo nota interna). O
    //     ticket está encerrado para fins operacionais; reabrir exige
    //     mudança explícita de status.
    //   - `resolvido`: o atendimento já foi concluído pelo técnico e o
    //     ticket aguarda confirmação do solicitante. Mensagens **públicas**
    //     ficam bloqueadas — qualquer comentário adicional do solicitante
    //     deve vir após a transição (reabrir ou confirmar fechamento).
    //     Notas internas continuam permitidas, porque o time pode
    //     precisar registrar contexto antes do ciclo encerrar.
    //
    // A UI do composer já honra essa restrição (esconde o composer
    // público / força nota interna), mas revalidamos aqui porque a
    // Server Action também é alcançável via fetch direto.
    if (ticket.status === "fechado") {
        return {
            ok: false,
            error: {
                code: "TICKET_CLOSED",
                message:
                    "O ticket está fechado e não aceita novas mensagens.",
            },
        };
    }

    if (ticket.status === "resolvido" && !input.isInternal) {
        return {
            ok: false,
            error: {
                code: "TICKET_RESOLVED",
                message:
                    "O ticket foi marcado como resolvido. Confirme o fechamento ou reabra antes de adicionar novas mensagens.",
            },
        };
    }

    const row = await db.transaction(async (tx) => {
        const inserted = await insertMessage(tx, {
            ticketId: ticket.id,
            authorId: actor.id,
            body: input.body,
            isInternal: input.isInternal,
        });

        // Fan-out de notificações para a contraparte da conversa
        // (assignee ou requester, dependendo do autor). Em transação
        // pra que mensagem e notificações vivam ou morram juntas.
        await notifyMessagePosted(
            tx,
            ticket,
            actor,
            input.isInternal,
            input.body,
        );

        return inserted;
    });

    return { ok: true, data: row };
}

/**
 * Lista a conversa de um ticket aplicando o filtro de visibilidade do
 * papel do usuário.
 *
 * - `solicitante`: `includeInternal=false` — notas internas ficam ocultas
 *   (R7.4).
 * - `tecnico`/`admin`: `includeInternal=true` — recebem a conversa
 *   completa, incluindo `Notas_Internas` (R7.5).
 *
 * O ordenamento cronológico ascendente é responsabilidade do repositório
 * (R7.8). Esta função **não** verifica `canViewTicket` por si só: o
 * caller (página/Server Action) já garante que o ticket é visível antes
 * de pedir as mensagens; tickets ocultos do solicitante simplesmente não
 * chegam até aqui.
 *
 * Validates: R7.4, R7.5, R7.8.
 */
export async function listMessagesForUser(
    user: SessionUser,
    ticketId: string,
): Promise<MessageRow[]> {
    const includeInternal = user.role !== "solicitante";
    return listMessagesForTicket(db, ticketId, includeInternal);
}
