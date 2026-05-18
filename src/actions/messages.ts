/**
 * Server Actions de mensagens em tickets do NaveDesk.
 *
 * Concentra a borda HTTP de postagem de mensagens públicas e notas
 * internas (`ticket_messages`). A action segue o contrato padrão das
 * Server Actions do projeto:
 *
 * 1. Garante autenticação via `auth()` — sem sessão, devolve
 *    `ActionResult.error.code="UNAUTHORIZED"` (R1, defesa em
 *    profundidade sobre o middleware).
 * 2. Valida a entrada bruta (`unknown`) com `PostMessageSchema`,
 *    retornando `code="VALIDATION"` e o `field` quando o erro está
 *    amarrado a um campo específico — útil para `react-hook-form`
 *    exibir mensagens contextuais.
 * 3. Delega a regra de negócio (RBAC + persistência) ao serviço
 *    `messages.service.postMessage`, que devolve um `ActionResult`
 *    pronto.
 * 4. Em sucesso, dispara `revalidatePath("/tickets/{id}")` para que
 *    a página do ticket re-renderize com a nova mensagem na próxima
 *    navegação (R7.7).
 *
 * Validates: R7.7.
 */

"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { PostMessageSchema } from "@/lib/schemas";
import type { MessageRow } from "@/db/repositories/messages.repo";
import { postMessage as svcPostMessage } from "@/services/messages.service";
import type { ActionResult } from "@/types/domain";

/**
 * Posta uma mensagem (pública ou nota interna) em um ticket.
 *
 * O `rawInput` chega tipado como `unknown` justamente para forçar o
 * parse Zod na borda — Server Actions são endpoints públicos do ponto
 * de vista de segurança e não podem confiar no shape entregue pelo
 * cliente.
 *
 * Validates: R7.7.
 */
export async function postMessageAction(
    ticketId: string,
    rawInput: unknown,
): Promise<ActionResult<MessageRow>> {
    const session = await auth();
    if (!session?.user) {
        return {
            ok: false,
            error: {
                code: "UNAUTHORIZED",
                message: "Sessão inválida.",
            },
        };
    }

    const parsed = PostMessageSchema.safeParse(rawInput);
    if (!parsed.success) {
        const issue = parsed.error.issues[0];
        return {
            ok: false,
            error: {
                code: "VALIDATION",
                message: issue?.message ?? "Entrada inválida.",
                ...(issue?.path.length ? { field: issue.path.join(".") } : {}),
            },
        };
    }

    const result = await svcPostMessage(session.user, ticketId, parsed.data);
    if (result.ok) {
        revalidatePath(`/tickets/${ticketId}`);
    }
    return result;
}
