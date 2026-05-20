/**
 * Cron endpoint — escala alertas de SLA.
 *
 * Roda periodicamente (recomendado a cada 5 minutos) e analisa
 * tickets ativos contra o SLA computado:
 *
 * - Nível `warn` (>= 50% do prazo decorrido, ainda dentro do prazo):
 *   notifica todos os técnicos+admins ativos. Ideia é dar uma
 *   "última chamada" antes de violar.
 * - Nível `breached` (prazo vencido): notifica todos os admins.
 *   Significa que a fila falhou em atender; alguém precisa
 *   intervir.
 *
 * Idempotência: a tabela `sla_alerts` registra cada (ticket, nível)
 * já alertado. INSERT ... ON CONFLICT garante que execuções
 * repetidas não dupliquem notificações.
 *
 * Segurança: exige `Authorization: Bearer <CRON_SECRET>` se a env
 * estiver configurada, igual ao auto-close.
 */

import { NextResponse } from "next/server";
import { notInArray, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { listByRoles } from "@/db/repositories/users.repo";
import { tickets } from "@/db/schema";
import { publishEvent } from "@/lib/realtime";
import { computeSlaInfo } from "@/lib/sla";
import { getAllSlaPolicies } from "@/services/reads.service";
import { insertNotifications } from "@/db/repositories/notifications.repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
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

    const [policies, activeTickets, technicians, admins] = await Promise.all([
        getAllSlaPolicies(),
        db
            .select({
                id: tickets.id,
                title: tickets.title,
                priority: tickets.priority,
                status: tickets.status,
                slaDeadline: tickets.slaDeadline,
                requesterId: tickets.requesterId,
                assigneeId: tickets.assigneeId,
            })
            .from(tickets)
            .where(notInArray(tickets.status, ["resolvido", "fechado"])),
        listByRoles(db, ["tecnico", "admin"]),
        listByRoles(db, ["admin"]),
    ]);

    let warnAlerts = 0;
    let breachedAlerts = 0;

    for (const ticket of activeTickets) {
        const info = computeSlaInfo(
            ticket.slaDeadline,
            ticket.priority,
            policies,
            now,
        );

        // Tickets em `ok` ou `crit` não disparam alerta automatizado.
        // `warn` (>= 50%) dispara para a fila ampla; `breached` (vencido)
        // dispara para admins.
        if (info.level !== "warn" && info.level !== "breached") continue;

        const targets =
            info.level === "warn"
                ? technicians.filter(
                    (u) =>
                        // Não avisa o assignee (ele já é o responsável e
                        // sabe; a ideia do escalonamento é mobilizar a
                        // fila quando o assignee falhou em responder).
                        u.id !== ticket.assigneeId,
                )
                : admins;

        if (targets.length === 0) continue;

        // Garante atomicidade: registra o alerta + insere notificações
        // dentro da mesma transação. Se duas execuções concorrentes
        // chegarem aqui ao mesmo tempo, a UNIQUE em (ticket_id, level)
        // faz a segunda virar no-op e não duplicamos notificações.
        const created = await db.transaction(async (tx) => {
            // INSERT raw porque `sla_alerts` não está no schema
            // Drizzle (foi criada via SQL manual). A `RETURNING id`
            // nos diz se a linha foi de fato inserida ou pulada por
            // conflito (segunda execução com o mesmo nível).
            const result = await tx.execute<{ id: string }>(sql`
                INSERT INTO sla_alerts (ticket_id, level)
                VALUES (${ticket.id}, ${info.level})
                ON CONFLICT (ticket_id, level) DO NOTHING
                RETURNING id
            `);

            // node-postgres retorna `{ rows, rowCount, ... }`. Quando
            // o INSERT é pulado por conflito, `rowCount` é 0 e `rows`
            // está vazio.
            const inserted = (result as unknown as { rowCount?: number })
                .rowCount;
            if (!inserted || inserted === 0) return false;

            const titlePrefix =
                info.level === "warn"
                    ? "Alerta de SLA"
                    : "SLA violado";
            const body =
                info.level === "warn"
                    ? `${ticket.id} passou de 50% do prazo de SLA sem resolução. Verifique o atendimento.`
                    : `${ticket.id} violou o prazo de SLA. Intervenção necessária.`;

            await insertNotifications(
                tx,
                targets.map((u) => ({
                    userId: u.id,
                    ticketId: ticket.id,
                    type: "ticket_status_changed" as const,
                    title: `${titlePrefix}: ${ticket.id}`,
                    body,
                    actorId: null,
                })),
            );

            // Broadcast SSE para que cada destinatário receba o badge
            // de não-lidas atualizado em tempo real.
            for (const u of targets) {
                await publishEvent(tx, {
                    type: "notification",
                    userId: u.id,
                    ticketId: ticket.id,
                });
            }

            return true;
        });

        if (created) {
            if (info.level === "warn") warnAlerts++;
            else breachedAlerts++;
        }
    }

    return NextResponse.json({
        ok: true,
        checked: activeTickets.length,
        warnAlerts,
        breachedAlerts,
        timestamp: now.toISOString(),
    });
}
