/**
 * Property-Based Test — Property 2: SLA monotônico no tempo.
 *
 * Ao manter `deadline`, `priority` e `policies` fixos e avançar `now`, o
 * tempo restante (`remainingMs`) precisa decrescer estritamente. Se isso
 * não valer, o medidor de SLA poderia "ficar parado" ou "voltar atrás",
 * quebrando a percepção do usuário sobre o consumo do prazo.
 *
 * Para quaisquer `(deadline, priority, policies)` válidos e quaisquer dois
 * instantes `now1 < now2`:
 *
 *   computeSlaInfo(deadline, priority, policies, now2).remainingMs
 *     <
 *   computeSlaInfo(deadline, priority, policies, now1).remainingMs
 *
 * Validates: Requirements 6.3
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";

import { computeSlaInfo } from "@/lib/sla";
import type { Priority, SlaPolicy } from "@/types/domain";

/** Gera uma `Priority` válida do domínio. */
const priorityArb: fc.Arbitrary<Priority> = fc.constantFrom(
    "baixa",
    "media",
    "alta",
    "critica",
);

/** Gera minutos inteiros de 1 a 43_200 (~30 dias). */
const minutesArb: fc.Arbitrary<number> = fc.integer({ min: 1, max: 43_200 });

/**
 * Gera uma tripla `(now1, now2, deadline)` com `now1 < now2` estritamente,
 * dentro de uma janela ampla mas controlada para evitar overflow numérico.
 *
 * `deadline` é independente dos `now`s: a propriedade vale para qualquer
 * deadline (vencido, futuro distante, próximo de qualquer um dos `now`s),
 * porque `remainingMs = deadline - now` é estritamente decrescente em `now`.
 */
const timesArb: fc.Arbitrary<{ now1: Date; now2: Date; deadline: Date }> = fc
    .tuple(
        fc.integer({
            min: Date.UTC(2000, 0, 1),
            max: Date.UTC(2100, 0, 1),
        }),
        fc.integer({ min: 1, max: 365 * 24 * 60 * 60 * 1000 }),
        fc.integer({
            min: Date.UTC(1990, 0, 1),
            max: Date.UTC(2110, 0, 1),
        }),
    )
    .map(([baseMs, deltaMs, deadlineMs]) => ({
        now1: new Date(baseMs),
        now2: new Date(baseMs + deltaMs),
        deadline: new Date(deadlineMs),
    }));

describe("computeSlaInfo — Property 2: remainingMs é estritamente decrescente em now", () => {
    it("now1 < now2 ⟹ info2.remainingMs < info1.remainingMs", () => {
        fc.assert(
            fc.property(
                timesArb,
                priorityArb,
                minutesArb,
                ({ now1, now2, deadline }, priority, minutes) => {
                    const policies: SlaPolicy[] = [{ priority, minutes }];

                    const info1 = computeSlaInfo(deadline, priority, policies, now1);
                    const info2 = computeSlaInfo(deadline, priority, policies, now2);

                    expect(info2.remainingMs).toBeLessThan(info1.remainingMs);
                },
            ),
        );
    });
});
