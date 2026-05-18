/**
 * Property-Based Test — Property 1: SLA determinístico.
 *
 * `computeSlaDeadline` deve ser uma função pura e determinística que respeita
 * exatamente os minutos configurados na política da prioridade escolhida.
 *
 * Para qualquer `now` (Date válido), prioridade e quantidade de minutos, o
 * resultado satisfaz:
 *
 *   d.getTime() === now.getTime() + minutes * 60_000
 *
 * Além disso, duas chamadas com os mesmos argumentos retornam o mesmo `Date`
 * (determinismo).
 *
 * Validates: Requirements 6.2, 6.9
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";

import { computeSlaDeadline } from "@/lib/sla";
import type { Priority, SlaPolicy } from "@/types/domain";

const MS_PER_MINUTE = 60_000;

/** Gera uma `Priority` válida do domínio. */
const priorityArb: fc.Arbitrary<Priority> = fc.constantFrom(
    "baixa",
    "media",
    "alta",
    "critica",
);

/** Gera uma `Date` em janela razoável (2000-01-01 a 2100-01-01) para evitar
 * overflow ao somar até ~30 dias. */
const nowArb: fc.Arbitrary<Date> = fc
    .integer({
        min: Date.UTC(2000, 0, 1),
        max: Date.UTC(2100, 0, 1),
    })
    .map((ms) => new Date(ms));

/** Gera minutos inteiros de 1 a 43_200 (~30 dias) — cobre o intervalo
 * prático de qualquer política configurável (incluindo prazos sub-hora). */
const minutesArb: fc.Arbitrary<number> = fc.integer({ min: 1, max: 43_200 });

describe("computeSlaDeadline — Property 1: determinístico e respeita minutos da política", () => {
    it("d.getTime() === now.getTime() + minutes * 60_000 para qualquer (now, priority, minutes)", () => {
        fc.assert(
            fc.property(nowArb, priorityArb, minutesArb, (now, priority, minutes) => {
                const policies: SlaPolicy[] = [{ priority, minutes }];

                const deadline = computeSlaDeadline(now, priority, policies);

                expect(deadline.getTime()).toBe(
                    now.getTime() + minutes * MS_PER_MINUTE,
                );
            }),
        );
    });

    it("é determinístico: chamadas repetidas com os mesmos argumentos retornam o mesmo resultado", () => {
        fc.assert(
            fc.property(nowArb, priorityArb, minutesArb, (now, priority, minutes) => {
                const policies: SlaPolicy[] = [{ priority, minutes }];

                const a = computeSlaDeadline(now, priority, policies);
                const b = computeSlaDeadline(now, priority, policies);

                expect(a.getTime()).toBe(b.getTime());
            }),
        );
    });
});
