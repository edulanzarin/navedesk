/**
 * Server Actions para templates de ticket.
 *
 * Admin gerencia (CRUD); demais papéis apenas listam ativos via
 * Server Components que buscam direto do repositório.
 */

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db/client";
import {
    deleteTemplate as repoDelete,
    insertTemplate as repoInsert,
    updateTemplate as repoUpdate,
    type TicketTemplateRow,
} from "@/db/repositories/ticket-templates.repo";
import { auth } from "@/lib/auth";
import { canManageCategories } from "@/lib/policies";
import { PRIORITIES } from "@/lib/constants";
import type { ActionResult, SessionUser } from "@/types/domain";

const TemplateSchema = z.object({
    name: z.string().trim().min(2).max(80),
    title: z.string().trim().min(5).max(120),
    description: z.string().trim().min(10).max(2000),
    priority: z.enum(PRIORITIES),
    categoryId: z.string().min(1),
    departmentId: z.string().uuid().nullable().optional(),
    active: z.boolean().default(true),
});

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

function forbidden<T>(): ActionResult<T> {
    return {
        ok: false,
        error: {
            code: "FORBIDDEN",
            message: "Apenas administradores podem gerenciar templates.",
        },
    };
}

export async function createTemplateAction(
    rawInput: unknown,
): Promise<ActionResult<TicketTemplateRow>> {
    const actor = await getActor();
    if (!actor) return unauthorized();
    // Reusa policy de categorias (mesmo escopo: taxonomia administrativa).
    if (!canManageCategories(actor)) return forbidden();

    const parsed = TemplateSchema.safeParse(rawInput);
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

    const row = await repoInsert(db, parsed.data);
    revalidatePath("/admin/templates");
    revalidatePath("/tickets/novo");
    return { ok: true, data: row };
}

export async function updateTemplateAction(
    id: string,
    rawInput: unknown,
): Promise<ActionResult<TicketTemplateRow>> {
    const actor = await getActor();
    if (!actor) return unauthorized();
    if (!canManageCategories(actor)) return forbidden();

    const parsed = TemplateSchema.partial().safeParse(rawInput);
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

    const row = await repoUpdate(db, id, parsed.data);
    if (!row) {
        return {
            ok: false,
            error: { code: "NOT_FOUND", message: "Template não encontrado." },
        };
    }
    revalidatePath("/admin/templates");
    revalidatePath("/tickets/novo");
    return { ok: true, data: row };
}

export async function deleteTemplateAction(
    id: string,
): Promise<ActionResult<null>> {
    const actor = await getActor();
    if (!actor) return unauthorized();
    if (!canManageCategories(actor)) return forbidden();

    const ok = await repoDelete(db, id);
    if (!ok) {
        return {
            ok: false,
            error: { code: "NOT_FOUND", message: "Template não encontrado." },
        };
    }
    revalidatePath("/admin/templates");
    revalidatePath("/tickets/novo");
    return { ok: true, data: null };
}
