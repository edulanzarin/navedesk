/**
 * `TicketHistory` — Server Component que renderiza, em ordem
 * cronológica, a trilha de eventos (`ticket_events`) de um ticket
 * dentro da página `/tickets/[id]`.
 *
 * Modos de exibição:
 *
 * - **standalone** (default): renderiza dentro de um `Card` com título
 *   "Histórico". Mantém compatibilidade com qualquer caller histórico
 *   que ainda monte o componente fora de tabs.
 * - **bare** (`bare={true}`): apenas a lista de eventos com scroll
 *   interno limitado. Pensado para ser embutido dentro de um `<TabsContent>`
 *   que já provê o card e o cabeçalho de aba — evita aninhar dois cards.
 *
 * Em ambos os modos, eventos chegam **ordenados cronologicamente**
 * (`createdAt ASC`) pelo repository `events.repo.listEventsForTicket`;
 * o componente apenas itera. Atores são resolvidos via
 * `actorNamesById`, mapa pré-materializado pelo Server Component pai
 * em uma única consulta `inArray(users.id, ...)` (evita N+1).
 *
 * Visual:
 *
 * - Lista densa com separadores `border-t border-(--line-soft)` entre
 *   itens — mesma cadência usada pelo feed de "Atividades recentes" do
 *   dashboard, garantindo consistência visual entre as duas superfícies
 *   que mostram eventos.
 * - Em modo `bare`, a lista é envolvida por um contêiner com altura
 *   máxima (`max-h-[28rem]`) e `overflow-y-auto`. Isso evita que
 *   históricos longos empurrem o layout da página indefinidamente.
 *
 * Estado vazio:
 *
 * - Tickets recém-criados sempre possuem pelo menos um evento `created`
 *   (gravado na mesma transação do INSERT — R16.1). O estado vazio
 *   aqui é defensivo: cobre cenários patológicos como reabertura
 *   manual de um banco com a trilha truncada.
 *
 * Componente puro (Server Component): sem `"use client"`, sem hooks.
 *
 * Validates: R12.2, R16.9
 */

import { TicketEventItem } from "@/components/domain/ticket-event";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import type { EventRow } from "@/db/repositories/events.repo";
import { cn } from "@/lib/cn";

export interface TicketHistoryProps {
    /**
     * Lista de eventos do ticket, ordenados cronologicamente
     * (`createdAt ASC`). O componente confia na ordem fornecida pelo
     * caller — não reordena.
     */
    events: readonly EventRow[];
    /**
     * Mapa `actorId → nome` materializado pelo Server Component pai.
     * Atores ausentes (ex.: usuário removido após o evento) caem para
     * o placeholder "Usuário" definido em `<TicketEventItem />`.
     */
    actorNamesById: Record<string, string>;
    /**
     * Quando `true`, omite o `Card` wrapper e renderiza apenas a lista
     * (com scroll interno). Útil para embutir em um `<TabsContent>`.
     */
    bare?: boolean;
}

/**
 * Lista interna de eventos. Compartilhada entre os dois modos para que
 * a aparência da trilha permaneça idêntica dentro e fora do `Card`.
 */
function HistoryList({
    events,
    actorNamesById,
}: {
    events: readonly EventRow[];
    actorNamesById: Record<string, string>;
}) {
    if (events.length === 0) {
        return (
            <p className="text-sm text-(--ink-3)">
                Sem histórico para este ticket.
            </p>
        );
    }

    return (
        <ol className="flex flex-col" aria-label="Trilha de eventos do ticket">
            {events.map((event, idx) => (
                <li
                    key={event.id}
                    className={cn(
                        "py-3",
                        idx > 0 && "border-t border-(--line-soft)",
                    )}
                >
                    <TicketEventItem
                        event={event}
                        actorName={
                            actorNamesById[event.actorId] ?? "Usuário"
                        }
                    />
                </li>
            ))}
        </ol>
    );
}

export function TicketHistory({
    events,
    actorNamesById,
    bare = false,
}: TicketHistoryProps): React.ReactElement {
    if (bare) {
        return (
            <div className="max-h-[28rem] overflow-y-auto pr-1">
                <HistoryList
                    events={events}
                    actorNamesById={actorNamesById}
                />
            </div>
        );
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>Histórico</CardTitle>
            </CardHeader>
            <CardContent>
                <HistoryList
                    events={events}
                    actorNamesById={actorNamesById}
                />
            </CardContent>
        </Card>
    );
}
