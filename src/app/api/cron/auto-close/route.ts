/**
 * Cron endpoint — fecha em lote tickets "resolvido" há mais de 24h.
 *
 * Complementa o `autoCloseIfExpired` (lazy, por ticket) com uma varredura
 * ativa que garante que tickets não visualizados também sejam fechados.
 * Deve ser chamado periodicamente por um scheduler externo (cron do SO,
 * Vercel Cron, GitHub Actions, etc.).
 *
 * Segurança: protegido por `CRON_SECRET` — se a env estiver definida,
 * o header `Authorization: Bearer <secret>` é obrigatório. Se não estiver
 * definida, o endpoint aceita qualquer chamada (útil em dev).
 *
 * Método: GET (compatível com Vercel Cron e curl simples).
 */

import { NextResponse } from "next/server";
import { and, eq, lte } from "drizzle-orm";

import { db, type Database } from "@/db/client";
import { tickets } from "@/db/schema";
import { insertEvent } from "@/db/repositories/events.repo";
import { updateTicket } from "@/db/repositories/tickets.repo";

/** Janela de 24h — mesma constante usada no serviço. */
const AUTO_CLOSE_AFTER_MS = 24 * 60 * 60 * 1000;

export async function GET(request: Request) {
    // Verificação de segurança via CRON_SECRET.
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret) {
        const authHeader = request.headers.get("authorization");
        if (authHeader !== `Bearer ${cronSecret}`) {
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 },
            );
        }
    }

    const now = new Date();
    const cutoff = new Date(now.getTime() - AUTO_CLOSE_AFTER_MS);

    // Busca todos os tickets em "resolvido" com resolvedAt <= cutoff.
    const expiredTickets = await db
        .select()
        .from(tickets)
        .where(
            and(
                eq(tickets.status, "resolvido"),
                lte(tickets.resolvedAt, cutoff),
            ),
        );

    let closed = 0;

    for (const ticket of expiredTickets) {
        await db.transaction(async (tx) => {
            const executor = tx as unknown as Database;

            // Re-check dentro da transação para evitar race condition.
            const [fresh] = await executor
                .select()
                .from(tickets)
                .where(eq(tickets.id, ticket.id))
                .limit(1);

            if (!fresh || fresh.status !== "resolvido") return;

            await updateTicket(executor, fresh.id, {
                status: "fechado",
                closedAt: now,
                updatedAt: now,
            });

            // Usa o requesterId como ator do fechamento automático.
            await insertEvent(executor, {
                ticketId: fresh.id,
                type: "status_changed",
                actorId: fresh.requesterId,
                fromValue: "resolvido",
                toValue: "fechado",
            });
            await insertEvent(executor, {
                ticketId: fresh.id,
                type: "closed",
                actorId: fresh.requesterId,
                fromValue: "resolvido",
                toValue: null,
            });

            closed++;
        });
    }

    return NextResponse.json({
        ok: true,
        closed,
        checked: expiredTickets.length,
        timestamp: now.toISOString(),
    });
}
