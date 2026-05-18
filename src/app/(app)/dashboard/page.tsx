/**
 * Página `/dashboard` (Server Component).
 *
 * Visão geral do helpdesk: KPIs do dia, distribuição de tickets ativos
 * por prioridade e categoria, e o feed das últimas atividades. Tudo é
 * lido via `services/stats.service.getDashboardKpis(user)`, que já
 * aplica o escopo por papel — solicitantes recebem agregações restritas
 * aos próprios tickets (R10.6, R2.4). Esta página adiciona, no topo do
 * retorno do serviço, três lookups auxiliares para enriquecer a
 * apresentação:
 *
 * 1. **Categorias** via `listCategories()` (cache TTL 60s) — mapeia
 *    `categoryId → label` para que a distribuição "Por categoria" exiba
 *    nomes legíveis em vez de identificadores técnicos.
 * 2. **Atores** via `inArray(users.id, ...)` — mapeia `actorId → name`
 *    para os ≤ 20 eventos do feed. Uma única query restrita aos IDs
 *    distintos do feed evita N+1.
 * 3. **Tickets sob risco de SLA** — uma listagem enxuta de tickets
 *    ativos ordenada por `slaDeadline ASC` que alimenta o
 *    `SlaAlertBanner` (R10.5). A classificação `breached` × `crit` é
 *    feita aqui no servidor com `computeSlaInfo`, junto às políticas
 *    vigentes lidas via `getAllSlaPolicies()` (cache TTL 60s). O
 *    componente cliente recebe apenas as duas listas já classificadas.
 *
 * O componente é `async` (RSC puro): nenhum `"use client"`, nenhum
 * hook. Sub-elementos interativos são extraídos em ilhas de cliente
 * (`SlaAlertBanner` por enquanto; filtros chegam em tarefas
 * posteriores).
 *
 * Observações de design:
 *
 * - Defesa em profundidade sobre o middleware: `auth()` + `redirect`
 *   garantem que nenhuma renderização ocorra sem `session.user`,
 *   mesmo se a rota for excluída do `matcher` por engano (R1.1, R1.7).
 * - As leituras independentes rodam em paralelo via `Promise.all` para
 *   reduzir TTFB; a query de atores depende do feed, então roda em
 *   uma segunda etapa, mas é única e indexada por chave primária.
 * - A "Atividade recente" é um feed cronológico (R10.4): ícone do
 *   evento + frase descritiva pt-BR + identificador do ticket + tempo
 *   relativo. O verbo descritivo é separado do identificador para que
 *   a frase fique natural mesmo com nomes longos ou IDs como `NVD-9999`.
 *
 * Validates: R10.1, R10.2, R10.3, R10.4, R10.5, R10.6, R10.7.
 */

import { redirect } from "next/navigation";

import { and, asc, eq, inArray, notInArray, type SQL } from "drizzle-orm";

import { KpiCard } from "@/components/domain/kpi-card";
import { PriorityPill } from "@/components/domain/priority-pill";
import { TicketEventItem } from "@/components/domain/ticket-event";
import { PageHeader } from "@/components/layout/page-header";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { db } from "@/db/client";
import { tickets, users } from "@/db/schema";
import { auth } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { PRIORITIES } from "@/lib/constants";
import { computeSlaInfo } from "@/lib/sla";
import { getAllSlaPolicies, listCategories } from "@/services/reads.service";
import { getDashboardKpis } from "@/services/stats.service";
import type { SessionUser } from "@/types/domain";

import {
    SlaAlertBanner,
    type SlaAlertBannerTicket,
} from "./sla-alert-banner";

/**
 * Limite da listagem usada para alimentar o `SlaAlertBanner`. Buscamos
 * os tickets ativos com os menores `slaDeadline` — todos os já
 * vencidos cabem aqui em qualquer cenário plausível, e o restante
 * ainda dá visibilidade suficiente para classificar `crit` sem
 * tornar o RSC pesado. Caso o operador realmente esteja com mais de
 * 100 tickets ativos em risco, o banner exibe os primeiros e o
 * problema deve ser tratado fora da UI.
 */
const SLA_BANNER_QUERY_LIMIT = 100;

export default async function DashboardPage() {
    // Defesa em profundidade — middleware já bloqueia anônimos, mas o
    // redirect explícito garante que nenhum bloco abaixo execute sem
    // `session.user` populado (R1.1, R1.7).
    const session = await auth();
    if (!session?.user) {
        redirect("/login");
    }
    const user = session.user satisfies SessionUser;

    // Leituras independentes em paralelo. `getDashboardKpis` já escopa
    // tudo por papel; `listCategories` e `getAllSlaPolicies` são estáveis
    // e têm cache TTL 60s. A consulta de tickets ativos para o banner
    // de SLA aplica o mesmo escopo do solicitante diretamente no SQL
    // (defesa em profundidade sobre `policies.canViewTicket`, R2.4).
    const requesterScope: SQL | undefined =
        user.role === "solicitante"
            ? eq(tickets.requesterId, user.id)
            : undefined;
    const slaCandidatesWhere = requesterScope
        ? and(
            notInArray(tickets.status, ["resolvido", "fechado"]),
            requesterScope,
        )
        : notInArray(tickets.status, ["resolvido", "fechado"]);

    const [kpis, categories, policies, slaCandidates] = await Promise.all([
        getDashboardKpis(user),
        listCategories(),
        getAllSlaPolicies(),
        db
            .select({
                id: tickets.id,
                title: tickets.title,
                priority: tickets.priority,
                slaDeadline: tickets.slaDeadline,
            })
            .from(tickets)
            .where(slaCandidatesWhere)
            .orderBy(asc(tickets.slaDeadline))
            .limit(SLA_BANNER_QUERY_LIMIT),
    ]);

    const categoryById = new Map(categories.map((c) => [c.id, c]));

    // Classifica os tickets candidatos pelo nível de SLA contra um único
    // `now`, garantindo coerência entre os dois blocos do banner.
    const now = new Date();
    const breached: SlaAlertBannerTicket[] = [];
    const atRisk: SlaAlertBannerTicket[] = [];
    for (const row of slaCandidates) {
        const info = computeSlaInfo(row.slaDeadline, row.priority, policies, now);
        if (info.level === "breached") {
            breached.push({ id: row.id, title: row.title, priority: row.priority });
        } else if (info.level === "crit") {
            atRisk.push({ id: row.id, title: row.title, priority: row.priority });
        }
    }

    // Resolve os nomes dos atores presentes no feed em uma única query
    // indexada por PK. Evita N+1 e mantém o RSC com apenas duas idas
    // ao banco no caminho feliz.
    const actorIds = Array.from(
        new Set(kpis.recentActivity.map((event) => event.actorId)),
    );
    const actorRows =
        actorIds.length > 0
            ? await db
                .select({ id: users.id, name: users.name })
                .from(users)
                .where(inArray(users.id, actorIds))
            : [];
    const actorNameById = new Map(actorRows.map((row) => [row.id, row.name]));

    const totalActivePriority = PRIORITIES.reduce(
        (sum, priority) => sum + kpis.byPriority[priority],
        0,
    );
    const totalActiveCategory = kpis.byCategory.reduce(
        (sum, row) => sum + row.count,
        0,
    );

    return (
        <div>
            <PageHeader
                title="Dashboard"
                description="Visão geral dos tickets"
            />

            {/* KPIs principais (R10.1). */}
            <section
                aria-label="Indicadores principais"
                className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
            >
                <KpiCard
                    label="Tickets abertos"
                    value={kpis.ticketsAbertos}
                />
                <KpiCard
                    label="Em andamento"
                    value={kpis.ticketsEmAndamento}
                />
                <KpiCard label="Aguardando" value={kpis.ticketsAguardando} />
                <KpiCard
                    label="Resolvidos hoje"
                    value={kpis.ticketsResolvidosHoje}
                />
            </section>

            {/* Banner de alerta de SLA (R10.5). Componente cliente que
                renderiza dois tratamentos visuais distintos para tickets
                já violados (`breached`) e tickets em atenção (`crit`). */}
            <SlaAlertBanner breached={breached} atRisk={atRisk} />

            {/* Distribuições por prioridade (R10.2) e categoria (R10.3). */}
            <section
                aria-label="Distribuições"
                className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2"
            >
                <Card>
                    <CardHeader>
                        <CardTitle>Por prioridade</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {totalActivePriority === 0 ? (
                            <p className="text-sm text-(--ink-3)">
                                Sem tickets ativos.
                            </p>
                        ) : (
                            <ul className="flex flex-col gap-3">
                                {PRIORITIES.map((priority) => (
                                    <li
                                        key={priority}
                                        className="flex items-center justify-between gap-3"
                                    >
                                        <PriorityPill priority={priority} />
                                        <span className="text-sm font-semibold tabular-nums text-(--ink-2)">
                                            {kpis.byPriority[priority]}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Por categoria</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {totalActiveCategory === 0 ? (
                            <p className="text-sm text-(--ink-3)">
                                Sem tickets ativos.
                            </p>
                        ) : (
                            <ul className="flex flex-col gap-3">
                                {kpis.byCategory.map((row) => {
                                    const cat = categoryById.get(row.categoryId);
                                    const label = cat?.label ?? row.categoryId;
                                    return (
                                        <li
                                            key={row.categoryId}
                                            className="flex items-center justify-between gap-3"
                                        >
                                            <span className="truncate text-sm text-(--ink)">
                                                {label}
                                            </span>
                                            <span className="text-sm font-semibold tabular-nums text-(--ink-2)">
                                                {row.count}
                                            </span>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </CardContent>
                </Card>
            </section>

            {/* Feed de atividades recentes (R10.4). */}
            <Card>
                <CardHeader>
                    <CardTitle>Atividades recentes</CardTitle>
                </CardHeader>
                <CardContent>
                    {kpis.recentActivity.length === 0 ? (
                        <p className="text-sm text-(--ink-3)">
                            Nenhuma atividade recente.
                        </p>
                    ) : (
                        // Altura travada com scroll interno: o feed
                        // mostra os 10 eventos mais recentes (limite
                        // do `stats.service`), e a barra de rolagem
                        // aparece se a lista crescer no futuro. Evita
                        // que o card empurre o restante da página.
                        <ul className="flex max-h-96 flex-col overflow-y-auto pr-1">
                            {kpis.recentActivity.map((event, idx) => {
                                const actorName =
                                    actorNameById.get(event.actorId) ??
                                    "Usuário";
                                return (
                                    <li
                                        key={event.id}
                                        className={cn(
                                            "py-3",
                                            idx > 0 &&
                                            "border-t border-(--line-soft)",
                                        )}
                                    >
                                        <TicketEventItem
                                            event={event}
                                            actorName={actorName}
                                            showTicketId
                                        />
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
