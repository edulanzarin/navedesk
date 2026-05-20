/**
 * Ticket templates repository — CRUD enxuto para os modelos
 * pré-preenchidos. Visibilidade ampla (qualquer usuário autenticado
 * pode listar ativos), mutações restritas a admin.
 */

import { and, asc, eq } from "drizzle-orm";

import type { Database } from "@/db/client";
import { ticketTemplates } from "@/db/schema";

export type TicketTemplateRow = typeof ticketTemplates.$inferSelect;
export type TicketTemplateInsert = typeof ticketTemplates.$inferInsert;

export async function listActiveTemplates(
    db: Database,
): Promise<TicketTemplateRow[]> {
    return db
        .select()
        .from(ticketTemplates)
        .where(eq(ticketTemplates.active, true))
        .orderBy(asc(ticketTemplates.name));
}

export async function listAllTemplates(
    db: Database,
): Promise<TicketTemplateRow[]> {
    return db.select().from(ticketTemplates).orderBy(asc(ticketTemplates.name));
}

export async function findTemplateById(
    db: Database,
    id: string,
): Promise<TicketTemplateRow | null> {
    const rows = await db
        .select()
        .from(ticketTemplates)
        .where(eq(ticketTemplates.id, id))
        .limit(1);
    return rows[0] ?? null;
}

export async function insertTemplate(
    db: Database,
    values: TicketTemplateInsert,
): Promise<TicketTemplateRow> {
    const [row] = await db
        .insert(ticketTemplates)
        .values(values)
        .returning();
    if (!row) throw new Error("insertTemplate: nada retornado.");
    return row;
}

export async function updateTemplate(
    db: Database,
    id: string,
    patch: Partial<TicketTemplateInsert>,
): Promise<TicketTemplateRow | null> {
    const rows = await db
        .update(ticketTemplates)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(ticketTemplates.id, id))
        .returning();
    return rows[0] ?? null;
}

export async function deleteTemplate(
    db: Database,
    id: string,
): Promise<boolean> {
    const rows = await db
        .delete(ticketTemplates)
        .where(eq(ticketTemplates.id, id))
        .returning({ id: ticketTemplates.id });
    return rows.length > 0;
}
