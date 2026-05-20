/**
 * Saved filters repository.
 *
 * Cada usuário guarda combinações nomeadas de filtros da listagem de
 * tickets. O `queryString` é o sufixo da URL (sem o `?` inicial) — a
 * página `/tickets` aplica diretamente como `?<queryString>`.
 */

import { and, desc, eq } from "drizzle-orm";

import type { Database } from "@/db/client";
import { savedFilters } from "@/db/schema";

export type SavedFilterRow = typeof savedFilters.$inferSelect;
export type SavedFilterInsert = typeof savedFilters.$inferInsert;

export async function listForUser(
    db: Database,
    userId: string,
): Promise<SavedFilterRow[]> {
    return db
        .select()
        .from(savedFilters)
        .where(eq(savedFilters.userId, userId))
        .orderBy(desc(savedFilters.createdAt));
}

export async function insertFilter(
    db: Database,
    values: SavedFilterInsert,
): Promise<SavedFilterRow> {
    const [row] = await db.insert(savedFilters).values(values).returning();
    if (!row) {
        throw new Error("insertFilter: nenhuma linha retornada após INSERT.");
    }
    return row;
}

export async function deleteFilter(
    db: Database,
    userId: string,
    id: string,
): Promise<boolean> {
    const rows = await db
        .delete(savedFilters)
        .where(and(eq(savedFilters.userId, userId), eq(savedFilters.id, id)))
        .returning({ id: savedFilters.id });
    return rows.length > 0;
}
