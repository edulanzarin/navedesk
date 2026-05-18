/**
 * Stats service — agrega os KPIs do dashboard (R10).
 *
 * Esta camada faz apenas leituras agregadas sobre `tickets` e `ticket_events`,
 * sem mutações nem efeitos colaterais. Cada chamada produz um snapshot
 * coerente com o instante `now` em que foi invocada e respeita o escopo do
 * papel do usuário:
 *
 * - **Solicitante**: todas as agregações e o feed de atividades ficam
 *   restritos a tickets em que `requesterId = user.id` (R10.6, R2.4). O
 *   filtro é aplicado no SQL — defesa em profundidade sobre
 *   `policies.canViewTicket`, garantindo que mesmo um bug na UI não
 *   exponha métricas de terceiros.
 * - **Tecnico/Admin**: visão global, sem escopo (R10.1).
 *
 * Sobre `ticketsEstourandoSla` e `hasSlaAlert`: o design pede destaque
 * quando há tickets `breached` **ou** `crit` (R10.5). Calcular `crit`
 * com fidelidade exigiria comparar `slaDeadline - now` contra 10% da
 * janela total da política — diferente por prioridade e potencialmente
 * obsoleto depois de mudanças em `sla_policies`. Optamos por um proxy
 * mais simples e auditável: contamos apenas os já vencidos
 * (`slaDeadline < now`) e usamos isso também como gatilho do alerta.
 * Esta decisão está documentada na issue da task 16.6 e é consistente
 * com a orientação explícita no plano de tarefas.
 *
 * Validates: R10.1, R10.2, R10.3, R10.4, R10.5, R10.6.
 */

import { and, count, eq, gte, lt, lte, ne, notInArray, type SQL } from "drizzle-orm";

import { db } from "@/db/client";
import { recentActivity, type EventRow } from "@/db/repositories/events.repo";
import { tickets } from "@/db/schema";
import type { Priority, SessionUser } from "@/types/domain";

/** Limite default do feed de atividades, conforme R10.4. */
const RECENT_ACTIVITY_LIMIT = 10;

/**
 * KPIs e dados agregados expostos pelo dashboard (R10).
 *
 * - `ticketsAbertos|EmAndamento|Aguardando`: contagens por status (R10.1).
 * - `ticketsResolvidosHoje`: tickets resolvidos no dia corrente
 *   (`startOfDay ≤ resolvedAt ≤ now`). Aplica fuso local do servidor
 *   porque o produto é único-tenant (Contábil Andrade) e opera em pt-BR.
 * - `ticketsEstourandoSla`: tickets ativos (`status ∉ {resolvido, fechado}`)
 *   com `slaDeadline < now` (proxy "breached only" — ver doc do módulo).
 * - `byPriority`: distribuição de tickets ativos (`status ≠ fechado`)
 *   por prioridade (R10.2). Sempre contém todas as prioridades, com 0
 *   nas que não têm tickets — evita branches no consumidor da UI.
 * - `byCategory`: distribuição de tickets ativos por categoria (R10.3).
 *   Apenas categorias com pelo menos 1 ticket aparecem; ordem é a
 *   retornada pelo Postgres (não estável). Caller ordena se necessário.
 * - `recentActivity`: últimos 20 eventos por `createdAt DESC` (R10.4).
 * - `hasSlaAlert`: `true` quando há ao menos um ticket "estourando"
 *   (R10.5).
 */
export interface DashboardKpis {
    ticketsAbertos: number;
    ticketsEmAndamento: number;
    ticketsAguardando: number;
    ticketsResolvidosHoje: number;
    ticketsEstourandoSla: number;
    byPriority: Record<Priority, number>;
    byCategory: Array<{ categoryId: string; count: number }>;
    recentActivity: EventRow[];
    hasSlaAlert: boolean;
}

/**
 * Calcula o início do dia (00:00:00.000) no fuso local do servidor.
 *
 * Usar fuso local é coerente com o seed e com o fato de o sistema operar
 * em uma única empresa em pt-BR. Em deploys multi-fuso seria necessário
 * receber o offset do usuário; fora do escopo atual.
 */
function startOfLocalDay(now: Date): Date {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * Compõe um WHERE somando o filtro de requesterId quando o usuário é
 * solicitante a um conjunto de condições adicionais.
 *
 * - Quando `requesterScope` é `null`, retorna apenas a composição AND
 *   das condições (ou `undefined` se vazio).
 * - Quando `requesterScope` está presente, ele é AND-conjugado com as
 *   demais. `undefined` no array é filtrado para preservar a semântica
 *   do builder do Drizzle.
 */
function composeWhere(
    requesterScope: SQL | null,
    ...extra: Array<SQL | undefined>
): SQL | undefined {
    const parts = extra.filter((c): c is SQL => c !== undefined);
    if (requesterScope) parts.unshift(requesterScope);
    if (parts.length === 0) return undefined;
    if (parts.length === 1) return parts[0];
    return and(...parts);
}

/**
 * Conta linhas em `tickets` com o WHERE informado. Encapsula o padrão
 * `select({ value: count() }).from(tickets).where(...)` para reduzir
 * ruído nas chamadas e centralizar o tratamento da forma `{ value }`
 * retornada pelo Drizzle.
 *
 * `count()` é mapeado pelo Drizzle como `SQL<number>`, então o `value`
 * já chega tipado; ainda assim aplicamos `?? 0` por defesa caso o driver
 * devolva `null` em alguma agregação degenerada.
 */
async function countTickets(where: SQL | undefined): Promise<number> {
    const query = db.select({ value: count() }).from(tickets);
    const rows = where ? await query.where(where) : await query;
    return rows[0]?.value ?? 0;
}

/**
 * Calcula os KPIs do dashboard para o usuário informado (R10).
 *
 * As agregações não são executadas em uma única transação porque
 * dashboards são leituras eventualmente-consistentes — pequenas
 * variações entre as contagens (caso um ticket mude de status no
 * meio do cálculo) são aceitáveis e não justificam o custo de uma
 * transação serializável. As consultas independentes rodam em
 * paralelo via `Promise.all` para reduzir latência de p95.
 */
export async function getDashboardKpis(
    user: SessionUser,
): Promise<DashboardKpis> {
    const now = new Date();
    const startOfDay = startOfLocalDay(now);

    // Escopo do solicitante (R10.6, R2.4). `null` para tecnico/admin.
    const requesterScope: SQL | null =
        user.role === "solicitante"
            ? eq(tickets.requesterId, user.id)
            : null;

    // Filtros derivados, reusados em várias agregações.
    const activeFilter = ne(tickets.status, "fechado");
    const openTerminalFilter = notInArray(tickets.status, [
        "resolvido",
        "fechado",
    ]);

    const [
        ticketsAbertos,
        ticketsEmAndamento,
        ticketsAguardando,
        ticketsResolvidosHoje,
        ticketsEstourandoSla,
        priorityRows,
        categoryRows,
        activityRows,
    ] = await Promise.all([
        countTickets(
            composeWhere(requesterScope, eq(tickets.status, "aberto")),
        ),
        countTickets(
            composeWhere(requesterScope, eq(tickets.status, "andamento")),
        ),
        countTickets(
            composeWhere(requesterScope, eq(tickets.status, "aguardando")),
        ),
        // R10.1 — resolvidos hoje: usa janela [startOfDay, now] sobre `resolvedAt`.
        countTickets(
            composeWhere(
                requesterScope,
                eq(tickets.status, "resolvido"),
                gte(tickets.resolvedAt, startOfDay),
                lte(tickets.resolvedAt, now),
            ),
        ),
        // R10.1 — estourando SLA: ativos com prazo vencido (proxy "breached only").
        countTickets(
            composeWhere(
                requesterScope,
                openTerminalFilter,
                lt(tickets.slaDeadline, now),
            ),
        ),
        // R10.2 — distribuição por prioridade entre tickets ativos.
        db
            .select({ priority: tickets.priority, value: count() })
            .from(tickets)
            .where(composeWhere(requesterScope, activeFilter))
            .groupBy(tickets.priority),
        // R10.3 — distribuição por categoria entre tickets ativos.
        db
            .select({ categoryId: tickets.categoryId, value: count() })
            .from(tickets)
            .where(composeWhere(requesterScope, activeFilter))
            .groupBy(tickets.categoryId),
        // R10.4 — feed de atividades, escopado pelo solicitante quando aplicável.
        recentActivity(
            db,
            RECENT_ACTIVITY_LIMIT,
            user.role === "solicitante" ? user.id : undefined,
        ),
    ]);

    // Normaliza `byPriority` para conter todas as prioridades — caller não
    // precisa lidar com chaves ausentes (R10.2).
    const byPriority: Record<Priority, number> = {
        baixa: 0,
        media: 0,
        alta: 0,
        critica: 0,
    };
    for (const row of priorityRows) {
        byPriority[row.priority] = row.value ?? 0;
    }

    const byCategory = categoryRows.map((row) => ({
        categoryId: row.categoryId,
        count: row.value ?? 0,
    }));

    return {
        ticketsAbertos,
        ticketsEmAndamento,
        ticketsAguardando,
        ticketsResolvidosHoje,
        ticketsEstourandoSla,
        byPriority,
        byCategory,
        recentActivity: activityRows,
        hasSlaAlert: ticketsEstourandoSla > 0,
    };
}
