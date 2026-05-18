/**
 * Repository for the ticket audit trail.
 *
 * Backs Requirement 16 (Trilha de auditoria): all writes go through
 * `insertEvent`, list operations stay read-only (`ticket_events` is
 * append-only). `recentActivity` powers the dashboard activity feed
 * (R10.4) and accepts a requester filter so solicitantes only see events
 * for tickets they own (R10.6).
 */

import { and, asc, desc, eq } from "drizzle-orm";

import type { Database } from "@/db/client";
import { tickets, ticketEvents } from "@/db/schema";

export type EventRow = typeof ticketEvents.$inferSelect;
export type NewEvent = typeof ticketEvents.$inferInsert;

const DEFAULT_RECENT_ACTIVITY_LIMIT = 20;

/**
 * Append an event to the audit trail. The table is insert-only by contract;
 * services must call this from the same transaction that mutates the ticket
 * so the trail stays consistent (R16.1–R16.7).
 */
export async function insertEvent(
    db: Database,
    values: NewEvent,
): Promise<EventRow> {
    const [row] = await db.insert(ticketEvents).values(values).returning();

    if (!row) {
        throw new Error("Failed to insert ticket event: no row returned.");
    }

    return row;
}

/**
 * Return the chronological history of a ticket (R16.9).
 */
export async function listEventsForTicket(
    db: Database,
    ticketId: string,
): Promise<EventRow[]> {
    return db
        .select()
        .from(ticketEvents)
        .where(eq(ticketEvents.ticketId, ticketId))
        .orderBy(asc(ticketEvents.createdAt));
}

/**
 * Recent activity feed for the dashboard (R10.4).
 *
 * Ordered by `createdAt DESC` and capped (default 20). When
 * `requesterIdFilter` is provided, joins `tickets` to scope the feed to the
 * requester's own tickets — used for solicitantes (R10.6).
 */
export async function recentActivity(
    db: Database,
    limit: number = DEFAULT_RECENT_ACTIVITY_LIMIT,
    requesterIdFilter?: string,
): Promise<EventRow[]> {
    const safeLimit = Math.max(1, Math.floor(limit));

    if (requesterIdFilter) {
        const rows = await db
            .select({ event: ticketEvents })
            .from(ticketEvents)
            .innerJoin(tickets, eq(tickets.id, ticketEvents.ticketId))
            .where(eq(tickets.requesterId, requesterIdFilter))
            .orderBy(desc(ticketEvents.createdAt))
            .limit(safeLimit);

        return rows.map((row) => row.event);
    }

    return db
        .select()
        .from(ticketEvents)
        .orderBy(desc(ticketEvents.createdAt))
        .limit(safeLimit);
}
