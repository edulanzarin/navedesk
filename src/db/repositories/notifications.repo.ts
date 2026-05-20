/**
 * Notifications repository — acesso a `notifications` no Postgres.
 *
 * Cada função recebe o executor (`db` ou `tx`) como primeiro parâmetro,
 * permitindo que serviços enfileirem notificações dentro da mesma
 * transação que cria o evento de origem (ex.: `INSERT ticket` +
 * `INSERT notifications` para cada técnico).
 *
 * Funções:
 *
 * - `insertNotifications(executor, rows)`: insert em lote (uma única
 *   ida ao banco para fan-out de N destinatários).
 * - `countUnread(executor, userId)`: badge de não-lidas.
 * - `listForUser(executor, userId, opts)`: paginação cursor-based,
 *   mais recentes primeiro.
 * - `markAllRead(executor, userId)`: marca todas as não-lidas como
 *   lidas no instante atual; idempotente.
 */

import { and, desc, eq, isNull, lt, or, type SQL } from "drizzle-orm";
import { count } from "drizzle-orm";

import type { Database } from "@/db/client";
import { notifications } from "@/db/schema";

export type NotificationRow = typeof notifications.$inferSelect;
export type NotificationInsert = typeof notifications.$inferInsert;

/**
 * Cursor opaco para paginação. Encapsula o par `(createdAt, id)` da
 * última linha da página anterior — `id` desempata quando duas
 * notificações compartilham o mesmo timestamp (raro mas possível com
 * fan-out simultâneo).
 */
export interface NotificationCursor {
    createdAt: string;
    id: string;
}

export interface ListOptions {
    cursor?: NotificationCursor;
    limit?: number;
}

export interface NotificationPage {
    rows: NotificationRow[];
    nextCursor: NotificationCursor | null;
}

/** Limite default usado por `listForUser`. */
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * Insere notificações em lote. Aceita array vazio sem disparar query.
 *
 * Retorna as linhas persistidas (com `id` e `createdAt` do banco) caso
 * o caller precise — útil para testes e para emitir telemetria de
 * "quantas notificações foram efetivamente criadas".
 */
export async function insertNotifications(
    db: Database,
    values: NotificationInsert[],
): Promise<NotificationRow[]> {
    if (values.length === 0) return [];
    return db.insert(notifications).values(values).returning();
}

/**
 * Conta notificações não-lidas do usuário. Chamada a cada navegação
 * (no layout) para alimentar o badge da Sidebar.
 *
 * O índice parcial `notifications_unread_idx` torna esta query O(log
 * N) onde N = número de não-lidas, não o total da tabela.
 */
export async function countUnread(
    db: Database,
    userId: string,
): Promise<number> {
    const rows = await db
        .select({ value: count() })
        .from(notifications)
        .where(
            and(
                eq(notifications.userId, userId),
                isNull(notifications.readAt),
            ),
        );
    return rows[0]?.value ?? 0;
}

/**
 * Lista notificações do usuário paginadas via cursor.
 *
 * Ordenação: `createdAt DESC, id DESC`. O cursor codifica o par
 * `(createdAt, id)` da última linha entregue para que a próxima página
 * comece imediatamente depois. Buscamos `limit + 1` linhas para
 * detectar se há mais páginas — quando sobra uma, usamos a `limit`-ésima
 * linha como referência do próximo cursor e descartamos a sobra.
 */
export async function listForUser(
    db: Database,
    userId: string,
    opts: ListOptions = {},
): Promise<NotificationPage> {
    const requestedLimit = opts.limit ?? DEFAULT_LIMIT;
    const limit = Math.min(
        Math.max(1, Math.floor(requestedLimit)),
        MAX_LIMIT,
    );

    const conditions: SQL[] = [eq(notifications.userId, userId)];
    if (opts.cursor) {
        const cursorDate = new Date(opts.cursor.createdAt);
        // (createdAt, id) < (cursor.createdAt, cursor.id) em ordem desc.
        conditions.push(
            or(
                lt(notifications.createdAt, cursorDate),
                and(
                    eq(notifications.createdAt, cursorDate),
                    lt(notifications.id, opts.cursor.id),
                ),
            ) as SQL,
        );
    }

    const rows = await db
        .select()
        .from(notifications)
        .where(and(...conditions))
        .orderBy(desc(notifications.createdAt), desc(notifications.id))
        .limit(limit + 1);

    const hasNext = rows.length > limit;
    const pageRows = hasNext ? rows.slice(0, limit) : rows;

    let nextCursor: NotificationCursor | null = null;
    if (hasNext) {
        const last = pageRows[pageRows.length - 1];
        if (last) {
            nextCursor = {
                createdAt: last.createdAt.toISOString(),
                id: last.id,
            };
        }
    }

    return { rows: pageRows, nextCursor };
}

/**
 * Marca todas as notificações não-lidas do usuário como lidas. Operação
 * idempotente — chamada novamente no mesmo estado é no-op (nenhuma
 * linha encontrada para atualizar).
 *
 * Retorna o número de linhas afetadas para feedback opcional na UI.
 */
export async function markAllRead(
    db: Database,
    userId: string,
): Promise<number> {
    const now = new Date();
    const rows = await db
        .update(notifications)
        .set({ readAt: now })
        .where(
            and(
                eq(notifications.userId, userId),
                isNull(notifications.readAt),
            ),
        )
        .returning({ id: notifications.id });
    return rows.length;
}
