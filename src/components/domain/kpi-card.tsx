/**
 * Componente de domínio `KpiCard`.
 *
 * Cartão de indicador-chave (KPI) usado no dashboard para exibir métricas
 * agregadas — total de tickets abertos, em andamento, resolvidos, tempo
 * médio de resolução, etc. Espelha o bloco `.stat` da referência visual
 * em `.example/styles.css` e o esboço de interface em `design.md`
 * (seção *Components and Interfaces → KpiCard*).
 *
 * Layout (top-down):
 *
 * - `label`  — texto pequeno em `--ink-3`, identifica a métrica.
 * - `value`  — número grande (`text-2xl`, `font-semibold`, `tracking-tight`)
 *   com variação `tabular-nums` para alinhamento vertical em grades.
 * - `unit`   — sufixo opcional adjacente ao valor, em `--ink-3` (ex.: `h`).
 * - `delta`  — comparação com período anterior; ícone `TrendingUp`
 *   (verde) ou `TrendingDown` (vermelho) do `lucide-react`, número e
 *   rótulo de referência (ex.: "vs ontem").
 * - `spark`  — sparkline SVG no canto superior direito quando provida
 *   uma série numérica.
 *
 * O componente é **puro e amigável a Server Components**: não usa hooks
 * nem APIs de browser. O caminho do sparkline é computado a partir do
 * array `spark` por uma função determinística (`computeSparkPath`),
 * exportada para permitir testes unitários sem renderizar o componente.
 *
 * Convenção de cor do delta:
 *
 * - `direction: "up"`   → ícone `TrendingUp` em `--green`.
 * - `direction: "down"` → ícone `TrendingDown` em `--red`.
 *
 * A semântica (subir é bom ou ruim?) fica a cargo de quem consome o
 * componente: o chamador escolhe `direction` conforme o significado
 * desejado para a métrica em questão.
 *
 * Validates: R10.1, R19.4
 */

import * as React from "react";

import { TrendingDown, TrendingUp } from "lucide-react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";

/**
 * Descreve a variação de um KPI em relação a um período de referência.
 *
 * - `value`     — magnitude da variação (sempre positiva; o sinal é
 *   transmitido por `direction`).
 * - `direction` — `"up"` indica aumento, `"down"` indica queda.
 * - `reference` — rótulo curto descrevendo o período comparado
 *   (ex.: "vs ontem", "esta semana").
 */
export interface KpiCardDelta {
    value: number;
    direction: "up" | "down";
    reference: string;
}

export interface KpiCardProps {
    /** Nome curto da métrica (ex.: "Tickets abertos"). */
    label: string;
    /** Valor atual da métrica. Strings preservam formatação personalizada. */
    value: string | number;
    /** Sufixo opcional, exibido em tipografia menor (ex.: "h", "%"). */
    unit?: string;
    /** Variação opcional em relação a um período anterior. */
    delta?: KpiCardDelta;
    /** Série temporal opcional para renderizar um sparkline. */
    spark?: number[];
    /** Classes adicionais para customização pontual do contêiner. */
    className?: string;
}

/** Dimensões do sparkline (em unidades do `viewBox`). */
const SPARK_WIDTH = 56;
const SPARK_HEIGHT = 30;
/** Margem vertical interna para evitar que extremos toquem as bordas. */
const SPARK_PADDING = 2;

/**
 * Computa o atributo `d` de um sparkline a partir de uma série numérica.
 *
 * Função pura e determinística: para os mesmos `(values, width, height)`,
 * retorna sempre o mesmo path. Mapeia o índice do valor ao eixo X de
 * forma uniforme e o valor ao eixo Y de forma normalizada entre `min` e
 * `max` da série, com pequena margem vertical interna.
 *
 * Casos limite:
 *
 * - Série vazia       → string vazia (chamador deve evitar render do SVG).
 * - Série de 1 ponto  → linha horizontal centralizada verticalmente.
 * - Série constante   → linha horizontal centralizada (range vira 1
 *   para evitar divisão por zero).
 *
 * Exportada para permitir testes unitários sem renderizar o componente.
 */
export function computeSparkPath(
    values: number[],
    width: number,
    height: number,
): string {
    if (values.length === 0) return "";
    if (values.length === 1) {
        const y = (height / 2).toFixed(2);
        return `M0,${y} L${width.toFixed(2)},${y}`;
    }

    let min = values[0] as number;
    let max = values[0] as number;
    for (let i = 1; i < values.length; i++) {
        const v = values[i] as number;
        if (v < min) min = v;
        if (v > max) max = v;
    }
    const range = max - min || 1;
    const drawableHeight = height - SPARK_PADDING * 2;
    const denominator = values.length - 1;

    const segments: string[] = [];
    for (let i = 0; i < values.length; i++) {
        const v = values[i] as number;
        const x = (i / denominator) * width;
        const y = height - ((v - min) / range) * drawableHeight - SPARK_PADDING;
        segments.push(`${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`);
    }
    return segments.join(" ");
}

/**
 * Componente `KpiCard`.
 *
 * Server-component-friendly: não declara `"use client"`, não usa hooks.
 * Encapsula a `Card` primitiva, aplica padding `p-5` direto no contêiner
 * e posiciona o sparkline de forma absoluta no canto superior direito.
 */
export function KpiCard({
    label,
    value,
    unit,
    delta,
    spark,
    className,
}: KpiCardProps) {
    const sparkPath =
        spark && spark.length > 0
            ? computeSparkPath(spark, SPARK_WIDTH, SPARK_HEIGHT)
            : null;

    const isUp = delta?.direction === "up";
    const DeltaIcon = delta ? (isUp ? TrendingUp : TrendingDown) : null;

    return (
        <Card className={cn("relative overflow-hidden p-5", className)}>
            <div className="text-xs font-medium text-(--ink-3)">{label}</div>

            <div className="mt-2 flex items-baseline gap-1">
                <span className="text-2xl font-semibold leading-none tracking-tight tabular-nums text-(--ink)">
                    {value}
                </span>
                {unit ? (
                    <span className="text-sm text-(--ink-3)">{unit}</span>
                ) : null}
            </div>

            {delta && DeltaIcon ? (
                <div
                    className={cn(
                        "mt-2 inline-flex items-center gap-1 text-xs font-medium",
                        isUp ? "text-(--green)" : "text-(--red)",
                    )}
                >
                    <DeltaIcon aria-hidden="true" className="size-3.5" />
                    <span className="tabular-nums">{delta.value}</span>
                    <span className="font-normal text-(--ink-3)">
                        {delta.reference}
                    </span>
                </div>
            ) : null}

            {sparkPath ? (
                <svg
                    aria-hidden="true"
                    viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`}
                    className="absolute right-3.5 top-3.5 h-[30px] w-[56px] text-(--accent) opacity-80"
                    preserveAspectRatio="none"
                >
                    <path
                        d={sparkPath}
                        stroke="currentColor"
                        strokeWidth="1.4"
                        fill="none"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                    <path
                        d={`${sparkPath} L${SPARK_WIDTH},${SPARK_HEIGHT} L0,${SPARK_HEIGHT} Z`}
                        fill="currentColor"
                        opacity="0.08"
                    />
                </svg>
            ) : null}
        </Card>
    );
}
