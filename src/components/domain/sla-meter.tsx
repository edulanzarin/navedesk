/**
 * Componente de domínio `SlaMeter`.
 *
 * Indicador compacto do estado do SLA de um ticket. Consome `computeSlaInfo`
 * (puro) e mapeia o nível resultante para um tom do `Badge`:
 *
 * - `ok`       → tom `green`,  rótulo "Xd Yh restantes" (via `fmtDuration`)
 * - `warn`     → tom `amber`,  rótulo "Xh Ymin restantes"
 * - `crit`     → tom `red`,    rótulo "Ymin restantes"
 * - `breached` → tom `red`,    rótulo "Vencido há …"
 *
 * Quando o ticket está em estado terminal (`resolvido` ou `fechado`) o
 * componente renderiza um `—` neutro, sem consumir o cálculo de SLA.
 *
 * **Política de re-render (R19.4 + design)**: como esta linha aparece em
 * tabelas potencialmente com dezenas de tickets, evitamos re-renderizar a
 * cada tique do relógio. Um `setInterval` de 1s recomputa `SlaInfo` num
 * `ref`; o `setState` só dispara quando o `level` muda (cruzamento de
 * limiar). Assim, a coluna SLA não vira gargalo de listagem e ainda assim
 * reflete imediatamente quando um ticket entra em `warn`/`crit`/`breached`.
 *
 * O parâmetro `now` é exposto principalmente para testes determinísticos;
 * em produção, o componente usa `Date.now()` no efeito.
 *
 * Validates: R6.8, R19.4
 */

"use client";

import * as React from "react";

import { Badge } from "@/components/ui/badge";
import type { BadgeTone } from "@/lib/design-tokens";
import { fmtDuration } from "@/lib/format";
import { computeSlaInfo } from "@/lib/sla";
import type { Priority, SlaInfo, SlaPolicy, TicketStatus } from "@/types/domain";

export interface SlaMeterProps {
    /** Prazo do SLA, calculado na criação do ticket. */
    deadline: Date;
    /** Prioridade do ticket; resolve a política aplicada. */
    priority: Priority;
    /** Status atual do ticket. Em estado terminal, mostra `—`. */
    status: TicketStatus;
    /** Políticas vigentes (necessárias ao `computeSlaInfo`). */
    policies: SlaPolicy[];
    /**
     * Instante de referência. Default: `new Date()`. Útil para testes;
     * em produção, o componente sobrescreve via `setInterval`.
     */
    now?: Date;
}

/** Mapeamento `level → tom` do `Badge`. */
const LEVEL_TONE: Record<SlaInfo["level"], BadgeTone> = {
    ok: "green",
    warn: "amber",
    crit: "red",
    breached: "red",
};

/** Estados terminais nos quais a métrica não é exibida. */
function isTerminal(status: TicketStatus): boolean {
    return status === "resolvido" || status === "fechado";
}

/**
 * Formata o rótulo de tempo restante a partir do `SlaInfo`.
 *
 * - `breached`: `"Vencido há Xh"` usando `|remainingMs|`
 * - demais: `"Xh Ymin restantes"` usando `remainingMs`
 */
function formatLabel(info: SlaInfo): string {
    if (info.level === "breached") {
        return `Vencido há ${fmtDuration(Math.abs(info.remainingMs))}`;
    }
    return `${fmtDuration(info.remainingMs)} restantes`;
}

/**
 * Renderiza o indicador de SLA. Em estado terminal, retorna apenas um
 * traço neutro, mantendo o alinhamento da coluna na tabela.
 */
export function SlaMeter({
    deadline,
    priority,
    status,
    policies,
    now,
}: SlaMeterProps) {
    const terminal = isTerminal(status);

    /*
     * Snapshot inicial do SLA. Em estado terminal devolvemos um valor
     * inerte para preservar a ordem de hooks; o render decide depois se
     * exibe o badge ou apenas o traço neutro.
     */
    const initial = React.useMemo<SlaInfo>(
        () =>
            terminal
                ? { level: "ok", remainingMs: 0, pctElapsed: 0 }
                : computeSlaInfo(
                    deadline,
                    priority,
                    policies,
                    now ?? new Date(),
                ),
        // `now` é injetado em testes; em produção é capturado uma única
        // vez e depois atualizado pelo `setInterval`.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [terminal, deadline, priority, policies, now?.getTime()],
    );

    const [info, setInfo] = React.useState<SlaInfo>(initial);

    /*
     * Mantém um `ref` com o snapshot mais recente para que o efeito do
     * intervalo só dispare `setState` quando o `level` muda — evitando
     * renderizar a cada segundo em listagens longas.
     */
    const infoRef = React.useRef<SlaInfo>(initial);
    infoRef.current = info;

    React.useEffect(() => {
        // Em estado terminal o relógio é desnecessário, e em testes com
        // `now` injetado o consumidor controla o instante de referência.
        if (terminal || now !== undefined) return;

        const id = window.setInterval(() => {
            const next = computeSlaInfo(
                deadline,
                priority,
                policies,
                new Date(),
            );
            if (next.level !== infoRef.current.level) {
                setInfo(next);
            }
        }, 1000);

        return () => window.clearInterval(id);
    }, [terminal, deadline, priority, policies, now]);

    if (terminal) {
        return (
            <span aria-label="Sem SLA" className="text-(--ink-4) text-xs">
                —
            </span>
        );
    }

    return (
        <Badge tone={LEVEL_TONE[info.level]}>
            <span className="whitespace-nowrap tabular-nums">{formatLabel(info)}</span>
        </Badge>
    );
}
