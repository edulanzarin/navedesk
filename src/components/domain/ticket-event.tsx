/**
 * `TicketEventItem` — bloco de apresentação de um único evento da
 * trilha de auditoria de tickets (`ticket_events`).
 *
 * Centraliza, em um só lugar, três decisões que antes viviam dentro
 * da página `/dashboard`:
 *
 * 1. **Ícone por tipo de evento** — mapa estável `EVENT_ICONS`
 *    construído sobre `lucide-react`. Mantido como objeto literal de
 *    módulo para que o tree-shaking continue eficaz: cada importação
 *    é nominal e o mapa só agrega referências.
 * 2. **Verbo descritivo em pt-BR** — `describeEvent(event)` produz a
 *    parte da frase que segue o nome do ator (ex.: "alterou o status
 *    para 'Em andamento'"). Defensivo contra `toValue` inválido para
 *    eventos onde o campo é esperado (`status_changed`,
 *    `priority_changed`, `rated`): cai em uma versão genérica em vez
 *    de propagar `null`/`undefined` para a UI.
 * 3. **Layout do item** — pequeno avatar circular com `--accent-soft`
 *    + texto em duas linhas (frase descritiva, depois meta com tempo
 *    relativo e, opcionalmente, o identificador do ticket). Esse
 *    layout é compartilhado entre o feed do dashboard e o histórico
 *    da página de detalhe, com a única diferença sendo a presença do
 *    ID do ticket — relevante no dashboard (que mistura eventos de
 *    vários tickets) e redundante na página `/tickets/[id]`.
 *
 * Exposição:
 *
 * - `EVENT_ICONS` — útil para casos extraordinários onde o caller
 *   prefere compor o próprio layout (mantido público para não fechar
 *   essa porta).
 * - `describeEvent(event)` — função pura, fácil de testar e de
 *   reutilizar fora do componente.
 * - `TicketEventItem` — componente de apresentação puro (Server
 *   Component), sem `"use client"`, sem hooks.
 *
 * Validates: R10.4, R16.9.
 */

import {
    Flame,
    Plus,
    RefreshCw,
    Star,
    UserMinus,
    UserPlus,
    XCircle,
    type LucideIcon,
} from "lucide-react";

import type { EventRow } from "@/db/repositories/events.repo";
import {
    PRIORITY_LABELS_PT,
    STATUS_LABELS_PT,
    type EventType,
    type Priority,
    type TicketStatus,
} from "@/lib/constants";
import { relTime } from "@/lib/format";

/**
 * Mapa de ícones por tipo de evento. Cobre todos os valores do enum
 * `EVENT_TYPES` em `lib/constants.ts`; o `satisfies` garante que se
 * um novo tipo for adicionado o TypeScript exija um ícone aqui.
 */
export const EVENT_ICONS = {
    created: Plus,
    status_changed: RefreshCw,
    priority_changed: Flame,
    assigned: UserPlus,
    unassigned: UserMinus,
    rated: Star,
    closed: XCircle,
} as const satisfies Record<EventType, LucideIcon>;

/**
 * Constrói a frase pt-BR que descreve um evento, sem incluir o ator
 * nem o identificador do ticket — o caller posiciona esses elementos
 * com layout próprio.
 *
 * `toValue` está sempre disponível para `status_changed`,
 * `priority_changed` e `rated` conforme o contrato registrado em
 * `services/tickets.service.ts`, mas tratamos `undefined`/`null`
 * defensivamente: em caso de evento mal formado, ainda devolvemos uma
 * frase legível em vez de propagar `null` para a UI.
 */
export function describeEvent(event: EventRow): string {
    switch (event.type) {
        case "created":
            return "abriu o ticket";
        case "status_changed": {
            const status = event.toValue as TicketStatus | null;
            const label = status ? STATUS_LABELS_PT[status] : null;
            return label
                ? `alterou o status para “${label}”`
                : "alterou o status";
        }
        case "priority_changed": {
            const priority = event.toValue as Priority | null;
            const label = priority ? PRIORITY_LABELS_PT[priority] : null;
            return label
                ? `alterou a prioridade para “${label}”`
                : "alterou a prioridade";
        }
        case "assigned":
            return "assumiu o ticket";
        case "unassigned":
            return "removeu a atribuição";
        case "rated": {
            const rating = Number(event.toValue);
            if (!Number.isFinite(rating)) return "avaliou o ticket";
            return `avaliou com ${rating} estrela${rating === 1 ? "" : "s"}`;
        }
        case "closed":
            return "fechou o ticket";
    }
}

/**
 * Pequeno avatar circular com o ícone do tipo de evento. Aplica o
 * tom `--accent-soft` para reforçar a hierarquia visual: a trilha de
 * eventos é informativa, não acionável diretamente.
 *
 * Mantido como helper interno (não exportado) porque o item completo
 * já cobre o caso de uso esperado e expor o ícone solto convidaria a
 * reproduções inconsistentes do layout.
 */
function EventIcon({ type }: { type: EventType }) {
    const Icon = EVENT_ICONS[type];
    return (
        <span
            aria-hidden="true"
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-(--accent-soft) text-(--accent)"
        >
            <Icon className="size-4" />
        </span>
    );
}

export interface TicketEventItemProps {
    /** Linha bruta de `ticket_events` (vem direto do repository). */
    event: EventRow;
    /**
     * Nome resolvido do ator do evento. O caller deve materializar a
     * partir de `users` (uma query `inArray(users.id, ...)` cobre o
     * batch inteiro sem N+1). Quando `null`/`undefined`, cai para o
     * placeholder genérico "Usuário" — útil em janelas de
     * inconsistência (usuário deletado/migrado).
     */
    actorName: string;
    /**
     * Quando `true`, prefixa o tempo relativo com o identificador do
     * ticket (`NVD-XXXX`). Default `false` — o histórico de uma página
     * `/tickets/[id]` já está no contexto do ticket. O dashboard, que
     * mistura eventos de vários tickets, passa `true`.
     */
    showTicketId?: boolean;
}

/**
 * Renderiza um item da trilha de eventos com layout consistente entre
 * o feed do dashboard e o histórico do ticket. O componente não
 * impõe espaçamento vertical entre itens; isso fica a cargo do caller
 * (ex.: `<li>` com `border-t` em uma `<ol>`), porque cada superfície
 * tem necessidades um pouco distintas (separadores explícitos no
 * dashboard, lista densa no histórico).
 */
export function TicketEventItem({
    event,
    actorName,
    showTicketId = false,
}: TicketEventItemProps): React.ReactElement {
    return (
        <div className="flex items-start gap-3">
            <EventIcon type={event.type} />
            <div className="min-w-0 flex-1">
                <p className="text-sm text-(--ink)">
                    <span className="font-medium">{actorName}</span>{" "}
                    <span className="text-(--ink-2)">
                        {describeEvent(event)}
                    </span>
                </p>
                <p className="mt-0.5 text-xs text-(--ink-3)">
                    {showTicketId ? (
                        <>
                            <span className="font-mono text-(--ink-2)">
                                {event.ticketId}
                            </span>
                            {" · "}
                        </>
                    ) : null}
                    {relTime(event.createdAt)}
                </p>
            </div>
        </div>
    );
}
