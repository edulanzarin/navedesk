/**
 * Analytics service — agregações para o dashboard analítico.
 *
 * Consultas focadas em métricas operacionais:
 * - % de SLA cumprido (tickets resolvidos dentro do prazo)
 * - Tempo médio de resolução total e por categoria
 * - Ranking de técnicos por volume e por avaliação média
 *
 * Todos os números são derivados em SQL (aggregate functions) pra não
 * trafegar linhas inteiras de `tickets`. As funções aceitam um
 * `range` `(from, to)` opcional pra delimitar o período — sem range
 * usam "últimos 30 dias" como default.
 *
 * Retornos são serializáveis (numbers, strings, Date) — caem direto em
 * Server Components sem ajuste.
 */

import { and, desc, eq, gte, isNotNull, lte, sql, type SQL } from "drizzle-orm";

import { db } from "@/db/client";
import { categories, tickets, users } from "@/db/schema";

export interface DateRange {
    from: Date;
    to: Date;
}

export interface SlaSummary {
    /** Total de tickets resolvidos no período. */
    resolved: number;
    /** Quantos foram resolvidos dentro do prazo (`resolvedAt <= slaDeadline`). */
    onTime: number;
    /** Percentual `onTime / resolved`, ou `null` quando não há resolvidos. */
    pct: number | null;
}

export interface CategoryAvgResolution {
    categoryId: string;
    categoryLabel: string;
    /** Média em milissegundos. */
    avgMs: number;
    /** Quantos tickets resolvidos compõem a média. */
    sample: number;
}

export interface TechnicianRanking {
    userId: string;
    name: string;
    /** Tickets resolvidos no período. */
    resolved: number;
    /** Avaliação média (1..5) considerando tickets avaliados. */
    avgRating: number | null;
    /** Quantos resolvidos foram avaliados. */
    rated: number;
}

export interface VolumeByDay {
    /** ISO `YYYY-MM-DD`. */
    day: string;
    created: number;
    resolved: number;
}

export interface AnalyticsSummary {
    range: { from: string; to: string };
    sla: SlaSummary;
    avgResolutionMs: number | null;
    byCategory: CategoryAvgResolution[];
    techRanking: TechnicianRanking[];
    volumeByDay: VolumeByDay[];
}

/**
 * Período default: últimos 30 dias contados a partir de agora,
 * incluindo o dia atual completo. Mantemos `to` no fim do dia para
 * incluir tickets criados/resolvidos hoje.
 */
function defaultRange(): DateRange {
    const to = new Date();
    const from = new Date(to.getTime() - 30 * 24 * 60 * 60_000);
    return { from, to };
}

/**
 * % de SLA cumprido no período. Consideramos o ticket "no prazo"
 * quando `resolvedAt <= sla_deadline`. Tickets ainda não resolvidos
 * não entram na conta — são reportados separadamente em outro lugar
 * (banner de SLA / cron).
 */
async function loadSlaSummary(range: DateRange): Promise<SlaSummary> {
    const rows = await db
        .select({
            resolved: sql<number>`count(*)::int`,
            onTime: sql<number>`count(*) FILTER (WHERE resolved_at <= sla_deadline)::int`,
        })
        .from(tickets)
        .where(
            and(
                isNotNull(tickets.resolvedAt),
                gte(tickets.resolvedAt, range.from),
                lte(tickets.resolvedAt, range.to),
            ) as SQL,
        );

    const r = rows[0];
    if (!r || r.resolved === 0) {
        return { resolved: 0, onTime: 0, pct: null };
    }
    return {
        resolved: r.resolved,
        onTime: r.onTime,
        pct: r.onTime / r.resolved,
    };
}

/**
 * Tempo médio total de resolução em ms (`resolvedAt - createdAt`).
 * `null` quando não há dados.
 */
async function loadAvgResolution(range: DateRange): Promise<number | null> {
    const rows = await db
        .select({
            avg: sql<string>`AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)) * 1000)`,
        })
        .from(tickets)
        .where(
            and(
                isNotNull(tickets.resolvedAt),
                gte(tickets.resolvedAt, range.from),
                lte(tickets.resolvedAt, range.to),
            ) as SQL,
        );

    const raw = rows[0]?.avg;
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

/**
 * Tempo médio por categoria. Inclui o `label` via JOIN para a UI não
 * precisar de outra leitura.
 */
async function loadByCategory(range: DateRange): Promise<CategoryAvgResolution[]> {
    const rows = await db
        .select({
            categoryId: tickets.categoryId,
            categoryLabel: categories.label,
            avgMs: sql<string>`AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)) * 1000)`,
            sample: sql<number>`count(*)::int`,
        })
        .from(tickets)
        .leftJoin(categories, eq(tickets.categoryId, categories.id))
        .where(
            and(
                isNotNull(tickets.resolvedAt),
                gte(tickets.resolvedAt, range.from),
                lte(tickets.resolvedAt, range.to),
            ) as SQL,
        )
        .groupBy(tickets.categoryId, categories.label)
        .orderBy(sql`AVG(EXTRACT(EPOCH FROM (resolved_at - created_at))) DESC`);

    return rows.map((r) => ({
        categoryId: r.categoryId,
        categoryLabel: r.categoryLabel ?? r.categoryId,
        avgMs: Math.round(Number(r.avgMs ?? 0)),
        sample: r.sample,
    }));
}

/**
 * Ranking de técnicos por tickets resolvidos no período + avaliação
 * média recebida. Limitado a 20 entradas — o ranking faz sentido pra
 * times pequenos/médios; com mais que isso vira overhead visual e a
 * UI deve filtrar por departamento ou similar.
 */
async function loadTechRanking(range: DateRange): Promise<TechnicianRanking[]> {
    const rows = await db
        .select({
            userId: tickets.assigneeId,
            name: users.name,
            resolved: sql<number>`count(*)::int`,
            avgRating: sql<string>`AVG(rating)`,
            rated: sql<number>`count(rating)::int`,
        })
        .from(tickets)
        .innerJoin(users, eq(users.id, tickets.assigneeId))
        .where(
            and(
                isNotNull(tickets.resolvedAt),
                isNotNull(tickets.assigneeId),
                gte(tickets.resolvedAt, range.from),
                lte(tickets.resolvedAt, range.to),
            ) as SQL,
        )
        .groupBy(tickets.assigneeId, users.name)
        .orderBy(desc(sql`count(*)`))
        .limit(20);

    return rows
        .filter((r): r is typeof r & { userId: string } => r.userId !== null)
        .map((r) => ({
            userId: r.userId,
            name: r.name,
            resolved: r.resolved,
            avgRating:
                r.avgRating !== null && r.avgRating !== undefined
                    ? Math.round(Number(r.avgRating) * 10) / 10
                    : null,
            rated: r.rated,
        }));
}

/**
 * Volume diário de criação e resolução, agrupado por dia do calendário
 * (UTC). Usado para o gráfico de tendência. Dias sem dados aparecem
 * implicitamente — a UI preenche com 0 quando renderiza.
 */
async function loadVolumeByDay(range: DateRange): Promise<VolumeByDay[]> {
    // Two queries em paralelo, depois mescladas no caller.
    const [createdRows, resolvedRows] = await Promise.all([
        db
            .select({
                day: sql<string>`to_char(created_at::date, 'YYYY-MM-DD')`,
                count: sql<number>`count(*)::int`,
            })
            .from(tickets)
            .where(
                and(
                    gte(tickets.createdAt, range.from),
                    lte(tickets.createdAt, range.to),
                ) as SQL,
            )
            .groupBy(sql`created_at::date`),
        db
            .select({
                day: sql<string>`to_char(resolved_at::date, 'YYYY-MM-DD')`,
                count: sql<number>`count(*)::int`,
            })
            .from(tickets)
            .where(
                and(
                    isNotNull(tickets.resolvedAt),
                    gte(tickets.resolvedAt, range.from),
                    lte(tickets.resolvedAt, range.to),
                ) as SQL,
            )
            .groupBy(sql`resolved_at::date`),
    ]);

    const map = new Map<string, VolumeByDay>();
    for (const r of createdRows) {
        map.set(r.day, { day: r.day, created: r.count, resolved: 0 });
    }
    for (const r of resolvedRows) {
        const existing = map.get(r.day);
        if (existing) existing.resolved = r.count;
        else map.set(r.day, { day: r.day, created: 0, resolved: r.count });
    }
    return Array.from(map.values()).sort((a, b) => a.day.localeCompare(b.day));
}

/**
 * Carrega tudo num shot. Útil pra montar o dashboard em uma única
 * `Promise.all`.
 */
export async function getAnalyticsSummary(
    range: DateRange = defaultRange(),
): Promise<AnalyticsSummary> {
    const [sla, avgResolutionMs, byCategory, techRanking, volumeByDay] =
        await Promise.all([
            loadSlaSummary(range),
            loadAvgResolution(range),
            loadByCategory(range),
            loadTechRanking(range),
            loadVolumeByDay(range),
        ]);

    return {
        range: {
            from: range.from.toISOString(),
            to: range.to.toISOString(),
        },
        sla,
        avgResolutionMs,
        byCategory,
        techRanking,
        volumeByDay,
    };
}
