/**
 * Componente de domínio `PriorityPill`.
 *
 * Pílula que representa visualmente a prioridade de um ticket. Aplica o
 * mapeamento `prioridade → tom` definido em `design-tokens.tone.priority`
 * e exibe o rótulo pt-BR oficial vindo de `PRIORITY_LABELS_PT`.
 *
 * Mantém-se como wrapper fino sobre o primitivo `Badge` para preservar a
 * separação entre componentes genéricos (UI) e componentes de domínio.
 *
 * Validates: R19.4, R19.6, R20.4
 */

import { Badge } from "@/components/ui/badge";
import { PRIORITY_LABELS_PT, tone } from "@/lib/design-tokens";
import type { Priority } from "@/types/domain";

export interface PriorityPillProps {
    /** Prioridade do ticket. Determina o tom e o rótulo exibido. */
    priority: Priority;
}

/**
 * Renderiza a prioridade do ticket como pílula colorida.
 *
 * Exemplos:
 *
 * - `priority="critica"` → fundo `red-soft`, texto `red`, rótulo "Crítica".
 * - `priority="baixa"`   → fundo `grey-soft`, texto neutro, rótulo "Baixa".
 */
export function PriorityPill({ priority }: PriorityPillProps) {
    return (
        <Badge tone={tone.priority[priority]}>
            {PRIORITY_LABELS_PT[priority]}
        </Badge>
    );
}
