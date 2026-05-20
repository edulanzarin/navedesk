/**
 * `/api/relatorios/export` — gera um CSV com todos os tickets do
 * período + um bloco de KPIs no topo, pronto pra apresentar à
 * diretoria.
 *
 * Query string:
 * - `from=YYYY-MM-DD` — início do período (default: -30 dias)
 * - `to=YYYY-MM-DD` — fim do período (default: hoje)
 *
 * Apenas admins podem exportar. O CSV inclui `\uFEFF` (BOM UTF-8)
 * para que Excel abra com acentos corretos por padrão.
 */

import { and, asc, eq, gte, lte, type SQL } from "drizzle-orm";

import { db } from "@/db/client";
import { categories, departments, tickets, users } from "@/db/schema";
import { auth } from "@/lib/auth";
import { canManageUsers } from "@/lib/policies";
import { getAnalyticsSummary } from "@/services/analytics.service";
import type { SessionUser } from "@/types/domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function escapeCsv(value: unknown): string {
    if (value === null || value === undefined) return "";
    const str = String(value);
    if (/[",\n;]/.test(str)) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

function fmtMs(ms: number | null): string {
    if (ms === null) return "";
    const s = Math.round(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${h}h ${m.toString().padStart(2, "0")}min`;
}

function parseRange(url: URL): { from: Date; to: Date } {
    const fromParam = url.searchParams.get("from");
    const toParam = url.searchParams.get("to");
    const to = toParam ? new Date(toParam) : new Date();
    const from = fromParam
        ? new Date(fromParam)
        : new Date(to.getTime() - 30 * 24 * 60 * 60_000);
    return { from, to };
}

export async function GET(request: Request) {
    const session = await auth();
    const user = (session?.user as SessionUser | undefined) ?? null;
    if (!user) return new Response("Unauthorized", { status: 401 });
    if (!canManageUsers(user)) {
        return new Response("Forbidden", { status: 403 });
    }

    const url = new URL(request.url);
    const range = parseRange(url);

    // KPIs agregados.
    const summary = await getAnalyticsSummary(range);

    // Tickets do período (ordenados por criação asc).
    const rows = await db
        .select({
            id: tickets.id,
            title: tickets.title,
            status: tickets.status,
            priority: tickets.priority,
            categoryLabel: categories.label,
            departmentName: departments.name,
            requesterName: users.name,
            createdAt: tickets.createdAt,
            resolvedAt: tickets.resolvedAt,
            closedAt: tickets.closedAt,
            slaDeadline: tickets.slaDeadline,
            rating: tickets.rating,
        })
        .from(tickets)
        .leftJoin(categories, eq(tickets.categoryId, categories.id))
        .leftJoin(departments, eq(tickets.departmentId, departments.id))
        .leftJoin(users, eq(tickets.requesterId, users.id))
        .where(
            and(
                gte(tickets.createdAt, range.from),
                lte(tickets.createdAt, range.to),
            ) as SQL,
        )
        .orderBy(asc(tickets.createdAt));

    // Monta o CSV. Usa `\r\n` por compatibilidade com Excel/Outlook.
    const lines: string[] = [];

    // Bloco de resumo (linhas iniciais com #).
    const fromLabel = range.from.toISOString().slice(0, 10);
    const toLabel = range.to.toISOString().slice(0, 10);
    lines.push(`# Relatório Navedesk`);
    lines.push(`# Período: ${fromLabel} a ${toLabel}`);
    lines.push(
        `# Tickets resolvidos: ${summary.sla.resolved} | SLA cumprido: ${
            summary.sla.pct === null
                ? "—"
                : (summary.sla.pct * 100).toFixed(1) + "%"
        }`,
    );
    lines.push(
        `# Tempo médio de resolução: ${
            summary.avgResolutionMs === null
                ? "—"
                : fmtMs(summary.avgResolutionMs)
        }`,
    );
    lines.push("");

    // Cabeçalho.
    const header = [
        "ID",
        "Título",
        "Status",
        "Prioridade",
        "Categoria",
        "Departamento",
        "Solicitante",
        "Criado em",
        "Resolvido em",
        "Fechado em",
        "Prazo SLA",
        "Tempo de resolução",
        "Avaliação",
    ];
    lines.push(header.map(escapeCsv).join(","));

    for (const r of rows) {
        const resolutionMs =
            r.resolvedAt && r.createdAt
                ? r.resolvedAt.getTime() - r.createdAt.getTime()
                : null;
        lines.push(
            [
                r.id,
                r.title,
                r.status,
                r.priority,
                r.categoryLabel ?? "",
                r.departmentName ?? "",
                r.requesterName ?? "",
                r.createdAt.toISOString(),
                r.resolvedAt?.toISOString() ?? "",
                r.closedAt?.toISOString() ?? "",
                r.slaDeadline.toISOString(),
                fmtMs(resolutionMs),
                r.rating ?? "",
            ]
                .map(escapeCsv)
                .join(","),
        );
    }

    const body = "\uFEFF" + lines.join("\r\n");

    const filename = `navedesk-relatorio-${fromLabel}_${toLabel}.csv`;
    return new Response(body, {
        headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="${filename}"`,
            "Cache-Control": "no-store",
        },
    });
}
