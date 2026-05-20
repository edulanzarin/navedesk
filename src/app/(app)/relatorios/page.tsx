/**
 * Página `/relatorios` (Server Component, admin only).
 *
 * Dashboard analítico do helpdesk:
 * - Card de % de SLA cumprido nos últimos 30 dias
 * - Tempo médio de resolução
 * - Tabela: tempo médio por categoria
 * - Ranking de técnicos por volume e avaliação
 * - Volume diário (criação vs resolução)
 *
 * Range default: últimos 30 dias. Aceita `?from=YYYY-MM-DD&to=YYYY-MM-DD`
 * via query string para outros recortes.
 */

import { redirect } from "next/navigation";

import { Clock, ShieldCheck, Trophy } from "lucide-react";

import { KpiCard } from "@/components/domain/kpi-card";
import { PageHeader } from "@/components/layout/page-header";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { canManageUsers } from "@/lib/policies";
import { fmtDuration } from "@/lib/format";
import { getAnalyticsSummary } from "@/services/analytics.service";
import type { SessionUser } from "@/types/domain";

export const dynamic = "force-dynamic";

interface ReportsPageProps {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function pickFirst(v: string | string[] | undefined): string | undefined {
    if (Array.isArray(v)) return v[0];
    return v;
}

function parseRange(
    sp: Record<string, string | string[] | undefined>,
): { from: Date; to: Date } | undefined {
    const from = pickFirst(sp.from);
    const to = pickFirst(sp.to);
    if (!from || !to) return undefined;
    const f = new Date(from);
    const t = new Date(to);
    if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime())) return undefined;
    return { from: f, to: t };
}

function fmtPct(n: number | null): string {
    if (n === null) return "—";
    return `${(n * 100).toFixed(1)}%`;
}

function fmtMs(ms: number | null): string {
    if (ms === null) return "—";
    return fmtDuration(ms);
}

export default async function ReportsPage({ searchParams }: ReportsPageProps) {
    const session = await auth();
    if (!session?.user) redirect("/login");
    const actor = session.user satisfies SessionUser;
    // Reusamos o policy de gestão de usuários — admin only.
    if (!canManageUsers(actor)) redirect("/dashboard");

    const params = await searchParams;
    const range = parseRange(params);
    const data = await getAnalyticsSummary(range);

    const fromLabel = new Date(data.range.from).toLocaleDateString("pt-BR");
    const toLabel = new Date(data.range.to).toLocaleDateString("pt-BR");

    // Para o gráfico de barras simples, achamos o máximo entre criação
    // e resolução pra normalizar a altura de cada barra.
    const maxBar = data.volumeByDay.reduce(
        (acc, d) => Math.max(acc, d.created, d.resolved),
        0,
    );

    return (
        <div>
            <PageHeader
                title="Relatórios"
                description={`Período: ${fromLabel} — ${toLabel}`}
                actions={
                    <a
                        href={`/api/relatorios/export${(() => {
                            const sp = new URLSearchParams();
                            if (params.from)
                                sp.set("from", String(pickFirst(params.from)));
                            if (params.to)
                                sp.set("to", String(pickFirst(params.to)));
                            const qs = sp.toString();
                            return qs.length > 0 ? `?${qs}` : "";
                        })()}`}
                        className="inline-flex h-10 items-center gap-2 rounded-(--r-3) border border-hairline border-(--line) bg-(--bg-elev) px-4 text-sm font-medium text-(--ink) shadow-(--sh-1) transition-colors hover:bg-(--bg-sunk)"
                    >
                        Exportar CSV
                    </a>
                }
            />

            <section
                aria-label="Indicadores principais"
                className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3"
            >
                <KpiCard
                    label="SLA cumprido"
                    value={fmtPct(data.sla.pct)}
                    {...(data.sla.resolved > 0
                        ? {
                            delta: {
                                value: data.sla.onTime,
                                direction: "up",
                                reference: `de ${data.sla.resolved} resolvidos`,
                            },
                        }
                        : {})}
                />
                <KpiCard
                    label="Tempo médio de resolução"
                    value={fmtMs(data.avgResolutionMs)}
                />
                <KpiCard
                    label="Tickets resolvidos"
                    value={data.sla.resolved}
                />
            </section>

            <section className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
                {/* Tempo médio por categoria */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                            <Clock className="size-4" aria-hidden="true" />
                            Tempo médio por categoria
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="pb-5">
                        {data.byCategory.length === 0 ? (
                            <p className="text-sm text-(--ink-3)">
                                Sem dados no período.
                            </p>
                        ) : (
                            <ul className="flex flex-col gap-3">
                                {data.byCategory.map((c) => (
                                    <li
                                        key={c.categoryId}
                                        className="flex items-center justify-between gap-3"
                                    >
                                        <span className="truncate text-sm text-(--ink)">
                                            {c.categoryLabel}
                                        </span>
                                        <span className="flex items-baseline gap-2 text-right">
                                            <span className="text-sm font-semibold tabular-nums text-(--ink)">
                                                {fmtMs(c.avgMs)}
                                            </span>
                                            <span className="text-xs text-(--ink-3)">
                                                ({c.sample})
                                            </span>
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </CardContent>
                </Card>

                {/* Ranking de técnicos */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                            <Trophy className="size-4" aria-hidden="true" />
                            Ranking de técnicos
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="pb-5">
                        {data.techRanking.length === 0 ? (
                            <p className="text-sm text-(--ink-3)">
                                Sem dados no período.
                            </p>
                        ) : (
                            <ol className="flex flex-col gap-2">
                                {data.techRanking.map((t, i) => (
                                    <li
                                        key={t.userId}
                                        className="flex items-center justify-between gap-3"
                                    >
                                        <span className="flex min-w-0 items-center gap-2.5">
                                            <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-(--bg-sunk) text-xs font-semibold tabular-nums text-(--ink-2)">
                                                {i + 1}
                                            </span>
                                            <span
                                                className="min-w-0 truncate text-sm text-(--ink)"
                                                title={t.name}
                                            >
                                                {t.name}
                                            </span>
                                        </span>
                                        <span className="flex items-baseline gap-3 text-right">
                                            <span className="text-sm font-semibold tabular-nums text-(--ink)">
                                                {t.resolved}
                                            </span>
                                            {t.avgRating !== null ? (
                                                <span className="text-xs text-(--amber)">
                                                    ★ {t.avgRating.toFixed(1)}
                                                </span>
                                            ) : (
                                                <span className="text-xs text-(--ink-4)">
                                                    sem avaliação
                                                </span>
                                            )}
                                        </span>
                                    </li>
                                ))}
                            </ol>
                        )}
                    </CardContent>
                </Card>
            </section>

            {/* Volume diário */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                        <ShieldCheck className="size-4" aria-hidden="true" />
                        Volume diário
                    </CardTitle>
                </CardHeader>
                <CardContent className="pb-5">
                    {data.volumeByDay.length === 0 ? (
                        <p className="text-sm text-(--ink-3)">
                            Sem dados no período.
                        </p>
                    ) : (
                        <div className="flex flex-col gap-3">
                            <div className="flex h-32 items-end gap-1">
                                {data.volumeByDay.map((d) => {
                                    const createdH =
                                        maxBar > 0
                                            ? Math.max(
                                                2,
                                                (d.created / maxBar) * 100,
                                            )
                                            : 2;
                                    const resolvedH =
                                        maxBar > 0
                                            ? Math.max(
                                                2,
                                                (d.resolved / maxBar) * 100,
                                            )
                                            : 2;
                                    return (
                                        <div
                                            key={d.day}
                                            className="flex flex-1 flex-col items-center justify-end gap-0.5"
                                            title={`${d.day}: criados ${d.created}, resolvidos ${d.resolved}`}
                                        >
                                            <div className="flex w-full items-end justify-center gap-px">
                                                <div
                                                    className="w-1.5 rounded-t-sm bg-(--accent)"
                                                    style={{
                                                        height: `${createdH}%`,
                                                    }}
                                                />
                                                <div
                                                    className="w-1.5 rounded-t-sm bg-(--green)"
                                                    style={{
                                                        height: `${resolvedH}%`,
                                                    }}
                                                />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                            <div className="flex items-center justify-end gap-4 text-xs text-(--ink-3)">
                                <span className="inline-flex items-center gap-1.5">
                                    <span className="size-2 rounded-sm bg-(--accent)" />
                                    Criados
                                </span>
                                <span className="inline-flex items-center gap-1.5">
                                    <span className="size-2 rounded-sm bg-(--green)" />
                                    Resolvidos
                                </span>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
