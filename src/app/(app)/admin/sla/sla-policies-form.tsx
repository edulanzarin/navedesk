/**
 * `SlaPoliciesForm` — Client Component que renderiza o formulário de
 * edição das Politicas_SLA da página `/admin/sla`.
 *
 * Layout:
 *
 * - Um único `Card` agrupa as quatro linhas (uma por prioridade) para
 *   reforçar que "minutos de SLA" é uma única configuração logicamente
 *   coerente, ainda que persistida em quatro registros distintos.
 * - Cada linha contém: rótulo da prioridade (`PRIORITY_LABELS_PT`), um
 *   `Input type=number` com `min=1` (valor em **minutos**), o
 *   equivalente em `h Xmin` ao lado para legibilidade, e um botão
 *   `Salvar` que só fica habilitado quando o valor digitado difere do
 *   atual e é um inteiro estritamente positivo (R15.2).
 *
 * Comportamento:
 *
 * 1. O estado local (`drafts`) guarda o valor digitado por prioridade.
 *    `initialPolicies` é a base de comparação: o botão Salvar habilita
 *    apenas para linhas com `draft !== initial` e `Number.isInteger > 0`.
 * 2. No submit de uma linha, dispara `updateSlaPolicyAction({ priority,
 *    minutes })`. Em sucesso, atualiza o estado base (`baselines`) com
 *    o valor confirmado pelo servidor para que o botão volte ao estado
 *    "sem mudanças pendentes" e exibe um toast de êxito.
 * 3. Em erro (validação Zod no servidor, FORBIDDEN, etc.), exibe um
 *    toast de erro com a mensagem do `ActionResult` — não altera os
 *    baselines.
 *
 * Validação no cliente:
 *
 * - O `Input` usa `min=1`, `step=1` e `inputMode="numeric"` para guiar
 *   teclados móveis, mas a validação canônica acontece no servidor via
 *   `UpdateSlaPolicySchema` (R15.2). O cliente apenas evita disparar
 *   requisições obviamente inválidas (não-inteiros, ≤ 0, NaN), mantendo
 *   a borda como fonte da verdade.
 *
 * Validates: R15.1, R15.2, R15.3.
 */

"use client";

import * as React from "react";

import { updateSlaPolicyAction } from "@/actions/admin";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/use-toast";
import { PRIORITIES, PRIORITY_LABELS_PT } from "@/lib/constants";
import { getErrorMessage } from "@/lib/error-messages";
import type { Priority, SlaPolicy } from "@/types/domain";

export interface SlaPoliciesFormProps {
    /** Políticas vigentes carregadas pelo Server Component pai. */
    initialPolicies: SlaPolicy[];
}

/**
 * Estado por prioridade: `baseline` é o valor confirmado pelo servidor
 * (referência para detectar mudanças); `draft` é o valor atualmente
 * digitado pelo usuário. Mantemos o `draft` como `string` para permitir
 * estados intermediários ("", "1", "1a") sem coerção prematura.
 */
interface RowState {
    baseline: number;
    draft: string;
}

type StateByPriority = Record<Priority, RowState>;

/**
 * Constrói o estado inicial garantindo que toda prioridade tenha uma
 * linha visível, mesmo se `initialPolicies` estiver incompleto. Em
 * operação normal o seed pré-popula as quatro políticas, mas o RSC
 * pode chegar com lista parcial em ambientes de teste — usamos `0`
 * como sentinela de "não definido" e o input começa vazio.
 */
function buildInitialState(initialPolicies: SlaPolicy[]): StateByPriority {
    const byPriority = new Map<Priority, number>();
    for (const p of initialPolicies) byPriority.set(p.priority, p.minutes);

    const out = {} as StateByPriority;
    for (const priority of PRIORITIES) {
        const minutes = byPriority.get(priority) ?? 0;
        out[priority] = {
            baseline: minutes,
            draft: minutes > 0 ? String(minutes) : "",
        };
    }
    return out;
}

/**
 * Converte o `draft` em minutos válidos (inteiro > 0) ou `null` quando
 * inválido. Usar `null` em vez de lançar mantém o handler de submit
 * simples e centraliza a regra "aceita somente inteiros > 0" (R15.2)
 * em um único lugar.
 */
function parseMinutes(draft: string): number | null {
    if (draft.trim().length === 0) return null;
    const n = Number(draft);
    if (!Number.isFinite(n)) return null;
    if (!Number.isInteger(n)) return null;
    if (n <= 0) return null;
    return n;
}

/**
 * Formata `minutes` de forma humana: `30min`, `1h`, `2h 30min`, `3h`.
 * Útil ao lado do input numérico para que o admin enxergue rapidamente
 * o equivalente em horas/minutos enquanto digita.
 */
function formatMinutesLabel(minutes: number): string {
    if (minutes <= 0) return "—";
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h === 0) return `${m}min`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}min`;
}

export function SlaPoliciesForm({
    initialPolicies,
}: SlaPoliciesFormProps): React.ReactElement {
    const [state, setState] = React.useState<StateByPriority>(() =>
        buildInitialState(initialPolicies),
    );
    const [pendingPriority, setPendingPriority] =
        React.useState<Priority | null>(null);

    function handleChange(priority: Priority, value: string): void {
        setState((prev) => ({
            ...prev,
            [priority]: { ...prev[priority], draft: value },
        }));
    }

    async function handleSubmit(
        e: React.FormEvent<HTMLFormElement>,
        priority: Priority,
    ): Promise<void> {
        e.preventDefault();
        const row = state[priority];
        const minutes = parseMinutes(row.draft);
        if (minutes === null || minutes === row.baseline) return;

        setPendingPriority(priority);
        try {
            const result = await updateSlaPolicyAction({ priority, minutes });
            if (result.ok) {
                // Confirma o novo baseline com o valor que o servidor
                // efetivamente persistiu — isso volta o botão ao estado
                // "sem mudanças" sem precisar de revalidação.
                setState((prev) => ({
                    ...prev,
                    [priority]: {
                        baseline: result.data.minutes,
                        draft: String(result.data.minutes),
                    },
                }));
                toast({
                    variant: "success",
                    title: "Política de SLA atualizada",
                    description: `${PRIORITY_LABELS_PT[priority]}: ${formatMinutesLabel(result.data.minutes)}.`,
                });
            } else {
                toast({
                    variant: "error",
                    title: "Não foi possível atualizar a política",
                    description: getErrorMessage(result.error),
                });
            }
        } finally {
            setPendingPriority(null);
        }
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>Minutos por prioridade</CardTitle>
                <CardDescription>
                    Tickets já abertos preservam o prazo original. A nova
                    política se aplica apenas a chamados criados após o
                    salvamento. O valor é em minutos (ex.: 30 = 30 minutos,
                    120 = 2 horas).
                </CardDescription>
            </CardHeader>
            <CardContent>
                <div className="flex flex-col divide-y divide-(--line)">
                    {PRIORITIES.map((priority) => {
                        const row = state[priority];
                        const parsed = parseMinutes(row.draft);
                        const isValid = parsed !== null;
                        const isDirty =
                            isValid && parsed !== row.baseline;
                        const isPending = pendingPriority === priority;
                        const inputId = `sla-minutes-${priority}`;
                        const previewLabel =
                            isValid && parsed !== null
                                ? formatMinutesLabel(parsed)
                                : null;

                        return (
                            <form
                                key={priority}
                                onSubmit={(e) =>
                                    void handleSubmit(e, priority)
                                }
                                className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-end sm:justify-between"
                            >
                                <div className="flex flex-col gap-1.5 sm:flex-1">
                                    <label
                                        htmlFor={inputId}
                                        className="text-sm font-medium text-(--ink)"
                                    >
                                        {PRIORITY_LABELS_PT[priority]}
                                    </label>
                                    <div className="flex items-center gap-2">
                                        <Input
                                            id={inputId}
                                            type="number"
                                            min={1}
                                            step={1}
                                            inputMode="numeric"
                                            value={row.draft}
                                            onChange={(e) =>
                                                handleChange(
                                                    priority,
                                                    e.target.value,
                                                )
                                            }
                                            error={
                                                row.draft.length > 0 &&
                                                !isValid
                                            }
                                            aria-describedby={`${inputId}-hint`}
                                            className="max-w-[140px]"
                                        />
                                        <span
                                            id={`${inputId}-hint`}
                                            className="text-sm text-(--ink-3)"
                                        >
                                            minutos
                                            {previewLabel
                                                ? ` (${previewLabel})`
                                                : ""}
                                        </span>
                                    </div>
                                </div>
                                <div className="flex shrink-0 items-center gap-3">
                                    <span className="text-xs text-(--ink-3)">
                                        Atual:{" "}
                                        {row.baseline > 0
                                            ? formatMinutesLabel(row.baseline)
                                            : "—"}
                                    </span>
                                    <Button
                                        type="submit"
                                        variant="primary"
                                        size="sm"
                                        loading={isPending}
                                        disabled={!isDirty}
                                    >
                                        Salvar
                                    </Button>
                                </div>
                            </form>
                        );
                    })}
                </div>
            </CardContent>
        </Card>
    );
}
