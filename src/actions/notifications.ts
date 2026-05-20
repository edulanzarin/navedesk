/**
 * Server Actions de notificações do NaveDesk.
 *
 * Apenas duas operações públicas:
 *
 * - `markAllReadAction()` — marca todas as não-lidas do usuário corrente
 *   como lidas. Disparada quando o usuário entra em `/notificacoes`.
 * - `getUnreadCountAction()` — retorna o contador de não-lidas. Usada
 *   pelo polling do client (a cada 30s) para atualizar o badge na
 *   Sidebar e disparar notificações desktop quando aumenta.
 *
 * As ações sempre revalidam o layout para que `getSidebarCounts`
 * recarregue na próxima navegação.
 */

"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import * as notificationsService from "@/services/notifications.service";
import type { ActionResult, SessionUser } from "@/types/domain";

async function getActor(): Promise<SessionUser | null> {
    const session = await auth();
    return (session?.user as SessionUser | undefined) ?? null;
}

function unauthorized<T>(): ActionResult<T> {
    return {
        ok: false,
        error: { code: "UNAUTHORIZED", message: "Sessão inválida." },
    };
}

/**
 * Marca todas as notificações não-lidas do usuário corrente como
 * lidas. Idempotente.
 */
export async function markAllReadAction(): Promise<ActionResult<{ updated: number }>> {
    const actor = await getActor();
    if (!actor) return unauthorized<{ updated: number }>();

    const updated = await notificationsService.markAllRead(actor.id);

    // Invalida o layout pra que o badge da Sidebar reflita o novo
    // estado na próxima navegação.
    revalidatePath("/", "layout");

    return { ok: true, data: { updated } };
}

/**
 * Retorna o contador de notificações não-lidas. Lightweight — chamado
 * a cada 30s pelo polling do client.
 */
export async function getUnreadCountAction(): Promise<ActionResult<{ count: number }>> {
    const actor = await getActor();
    if (!actor) return unauthorized<{ count: number }>();

    const count = await notificationsService.countUnread(actor.id);
    return { ok: true, data: { count } };
}
