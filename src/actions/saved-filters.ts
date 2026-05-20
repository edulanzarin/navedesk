/**
 * Server Actions para filtros salvos da listagem de tickets.
 *
 * Cada usuário só vê e gerencia os próprios filtros — a verificação
 * é feita no SQL via `userId` da sessão.
 */

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db/client";
import {
    deleteFilter as repoDelete,
    insertFilter as repoInsert,
    type SavedFilterRow,
} from "@/db/repositories/saved-filters.repo";
import { auth } from "@/lib/auth";
import type { ActionResult, SessionUser } from "@/types/domain";

const SaveFilterSchema = z.object({
    name: z.string().trim().min(1).max(60),
    queryString: z.string().max(500),
});

async function getActor(): Promise<SessionUser | null> {
    const session = await auth();
    return (session?.user as SessionUser | undefined) ?? null;
}

export async function saveFilterAction(
    rawInput: unknown,
): Promise<ActionResult<SavedFilterRow>> {
    const actor = await getActor();
    if (!actor) {
        return {
            ok: false,
            error: { code: "UNAUTHORIZED", message: "Sessão inválida." },
        };
    }

    const parsed = SaveFilterSchema.safeParse(rawInput);
    if (!parsed.success) {
        const issue = parsed.error.issues[0];
        return {
            ok: false,
            error: {
                code: "VALIDATION_ERROR",
                message: issue?.message ?? "Dados inválidos.",
            },
        };
    }

    const row = await repoInsert(db, {
        userId: actor.id,
        name: parsed.data.name,
        queryString: parsed.data.queryString,
    });

    revalidatePath("/tickets");
    return { ok: true, data: row };
}

export async function deleteFilterAction(
    id: string,
): Promise<ActionResult<null>> {
    const actor = await getActor();
    if (!actor) {
        return {
            ok: false,
            error: { code: "UNAUTHORIZED", message: "Sessão inválida." },
        };
    }

    const ok = await repoDelete(db, actor.id, id);
    if (!ok) {
        return {
            ok: false,
            error: { code: "NOT_FOUND", message: "Filtro não encontrado." },
        };
    }

    revalidatePath("/tickets");
    return { ok: true, data: null };
}
