/**
 * Repository for ticket messages.
 *
 * Supports posting messages and notes (R7.1, R7.2) and listing the
 * conversation scoped by role (R7.4, R7.5, R7.8). The scoping decision is
 * passed as `includeInternal` so callers (services) keep the RBAC contract
 * explicit.
 */

import { and, asc, eq } from "drizzle-orm";

import type { Database } from "@/db/client";
import { ticketMessages } from "@/db/schema";

export type MessageRow = typeof ticketMessages.$inferSelect;
export type NewMessage = typeof ticketMessages.$inferInsert;

/**
 * Insert a new message (or internal note) into a ticket conversation.
 *
 * Returns the persisted row so callers can attach attachments or revalidate
 * caches with deterministic timestamps from the database.
 */
export async function insertMessage(
    db: Database,
    values: NewMessage,
): Promise<MessageRow> {
    const [row] = await db.insert(ticketMessages).values(values).returning();

    if (!row) {
        throw new Error("Failed to insert ticket message: no row returned.");
    }

    return row;
}

/**
 * List messages of a ticket ordered chronologically (R7.8).
 *
 * When `includeInternal` is `false`, internal notes are filtered out at the
 * SQL level so solicitantes never receive them (R7.4). Tecnicos and admins
 * pass `true` to receive the full conversation (R7.5).
 */
export async function listMessagesForTicket(
    db: Database,
    ticketId: string,
    includeInternal: boolean,
): Promise<MessageRow[]> {
    const condition = includeInternal
        ? eq(ticketMessages.ticketId, ticketId)
        : and(
            eq(ticketMessages.ticketId, ticketId),
            eq(ticketMessages.isInternal, false),
        );

    return db
        .select()
        .from(ticketMessages)
        .where(condition)
        .orderBy(asc(ticketMessages.createdAt));
}
