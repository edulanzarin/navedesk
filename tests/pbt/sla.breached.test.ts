/**
 * PBT — Propriedade 3 do cálculo de SLA.
 *
 * **Property 3: para `now ≥ deadline`, `level === "breached"`.**
 *
 * O nível `breached` é absorvente: assim que o instante observado alcança ou
 * ultrapassa o `deadline`, o `level` retornado por `computeSlaInfo` é fixado em
 * `"breached"`, independentemente da prioridade do ticket ou das horas
 * configuradas para a política. Esta propriedade protege a regra de UI que
 * marca tickets vencidos em vermelho (R6.7) contra regressões em que outros
 * limiares (warn/crit) acabariam respondendo no lugar.
 *
 * Estratégia de geração: amostramos uma `deadline` arbitrária, um offset
 * `offsetMs ≥ 0` em milissegundos e calculamos `now = deadline + offsetMs`.
 * Como `offsetMs` cobre `0` (caso de fronteira) e valores positivos, a
 * propriedade exercita tanto o instante exato do vencimento quanto cenários de
 * atraso significativo. As políticas geradas garantem ao menos uma entrada por
 * prioridade com `hours > 0`, permitindo que `computeSlaInfo` execute o
 * cálculo de `totalMs` sem cair no caminho de erro.
 *
 * **Validates: Requirements 6.7**
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";

import { computeSlaInfo } from "@/lib/sla";
import type { Priority, SlaPolicy } from "@/types/domain";

const PRIORITIES: readonly Priority[] = [
    "baixa",
    "media",
    "alta",
    "critica",
] as const;

/** Gera um `Date` finito e seguro (evita NaN/overflow nos cálculos de tempo). */
const dateArb = fc
    .integer({
        // Janela ampla mas longe dos extremos para evitar overflow ao somar `offsetMs`.
        min: new Date("1970-01-01T00:00:00Z").getTime(),
        max: new Date("2100-01-01T00:00:00Z").getTime(),
    })
    .map((ms) => new Date(ms));

/** Prioridade arbitrária a partir do conjunto canônico do domínio. */
const priorityArb: fc.Arbitrary<Priority> = fc.constantFrom(...PRIORITIES);

/**
 * Gera uma lista completa de políticas (uma por prioridade) com `hours > 0`,
 * cobrindo o pré-requisito de configuração total exigido por `findPolicy`.
 */
const policiesArb: fc.Arbitrary<SlaPolicy[]> = fc
    .tuple(
        fc.integer({ min: 1, max: 240 }),
        fc.integer({ min: 1, max: 240 }),
        fc.integer({ min: 1, max: 240 }),
        fc.integer({ min: 1, max: 240 }),
    )
    .map(([baixa, media, alta, critica]) => [
        { priority: "baixa", hours: baixa },
        { priority: "media", hours: media },
        { priority: "alta", hours: alta },
        { priority: "critica", hours: critica },
    ]);

/**
 * Offset não-negativo em milissegundos. Inclui `0` para o caso de fronteira
 * `now === deadline` e valores grandes para simular tickets há muito vencidos
 * sem extrapolar o intervalo seguro de `Date`.
 */
const offsetMsArb = fc.integer({
    min: 0,
    max: 365 * 24 * 60 * 60 * 1000, // até 1 ano de atraso.
});

describe("computeSlaInfo — Property 3: breached é absorvente", () => {
    it("para now ≥ deadline, level === 'breached' (Validates: Requirements 6.7)", () => {
        fc.assert(
            fc.property(
                dateArb,
                priorityArb,
                policiesArb,
                offsetMsArb,
                (deadline, priority, policies, offsetMs) => {
                    const now = new Date(deadline.getTime() + offsetMs);
                    const info = computeSlaInfo(deadline, priority, policies, now);
                    expect(info.level).toBe("breached");
                },
            ),
        );
    });
});
