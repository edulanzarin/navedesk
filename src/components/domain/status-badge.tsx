/**
 * Componente de domínio `StatusBadge`.
 *
 * Badge que representa o estado atual de um ticket no ciclo de vida da
 * máquina de estados. Aplica o mapeamento `status → tom` definido em
 * `design-tokens.tone.status` e exibe o rótulo pt-BR oficial vindo de
 * `STATUS_LABELS_PT`.
 *
 * Mantém-se como wrapper fino sobre o primitivo `Badge` para preservar a
 * separação entre componentes genéricos (UI) e componentes de domínio:
 * o primitivo só conhece tons, e o conhecimento de domínio (qual status
 * tem qual tom, qual rótulo) mora aqui.
 *
 * Validates: R19.4, R19.5, R20.4
 */

import { Badge } from "@/components/ui/badge";
import { STATUS_LABELS_PT, tone } from "@/lib/design-tokens";
import type { TicketStatus } from "@/types/domain";

export interface StatusBadgeProps {
    /** Status atual do ticket. Determina o tom e o rótulo exibido. */
    status: TicketStatus;
}

/**
 * Renderiza o status do ticket como badge colorido.
 *
 * Exemplos:
 *
 * - `status="aberto"`     → fundo `blue-soft`, texto `blue`, rótulo "Aberto".
 * - `status="andamento"`  → fundo `amber-soft`, texto `amber`, rótulo "Em andamento".
 * - `status="aguardando"` → fundo `grey-soft`, texto neutro, rótulo "Aguardando solicitante".
 * - `status="resolvido"`  → fundo `green-soft`, texto `green`, rótulo "Resolvido".
 * - `status="fechado"`    → fundo `grey-soft`, texto neutro, rótulo "Fechado".
 */
export function StatusBadge({ status }: StatusBadgeProps) {
    return (
        <Badge tone={tone.status[status]}>
            {STATUS_LABELS_PT[status]}
        </Badge>
    );
}
