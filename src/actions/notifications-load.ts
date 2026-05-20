/**
 * Server Action separada para carregar mais notificações via cursor.
 *
 * Mantida em arquivo próprio porque retorna um payload que precisa ser
 * serializável com timestamps em ISO strings — diferente da
 * `markAllReadAction` (que devolve apenas um contador). Usuários
 * curiosos podem importar do mesmo lugar caso prefiram.
 */

"use server";

import { auth } from "@/lib/auth";
import * as notificationsService from "@/services/notifications.service";
import type { NotificationCursor } from "@/db/repositories/notifications.repo";
import type { ActionResult, SessionUser } from "@/types/domain";

import type { SerializableNotification } from "@/app/(app)/notificacoes/notifications-list";

export interface LoadMoreResult {
    rows: SerializableNotification[];
    nextCursor: NotificationCursor | null;
}

export async function loadMoreNotificationsAction(
    cursor: NotificationCursor,
): Promise<ActionResult<LoadMoreResult>> {
    const session = await auth();
    const actor = (session?.user as SessionUser | undefined) ?? null;
    if (!actor) {
        return {
            ok: false,
            error: { code: "UNAUTHORIZED", message: "Sessão inválida." },
        };
    }

    const page = await notificationsService.listForUser(actor.id, {
        cursor,
        limit: 20,
    });

    return {
        ok: true,
        data: {
            rows: page.rows.map((row) => ({
                ...row,
                createdAt: row.createdAt.toISOString(),
                readAt: row.readAt?.toISOString() ?? null,
            })),
            nextCursor: page.nextCursor,
        },
    };
}
