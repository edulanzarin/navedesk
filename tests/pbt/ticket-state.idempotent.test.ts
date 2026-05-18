/**
 * Property-Based Test — Property 5: transição idempotente quando aplicável.
 *
 * Para os pares `(status, action)` em que a tabela de transições mapeia o
 * estado para si mesmo (self-loops), aplicar `transitionTicketStatus` deve
 * preservar o estado, e re-aplicar a mesma ação sobre o resultado deve
 * continuar produzindo o mesmo estado. Em símbolos:
 *
 *   transitionTicketStatus(s, a) === s
 *   transitionTicketStatus(transitionTicketStatus(s, a), a) === s
 *
 * Self-loops extraídos da tabela do design (ver `lib/ticket-state.ts`):
 *
 *   (aberto, RESPOND)            → aberto
 *   (andamento, ASSIGN)          → andamento
 *   (andamento, RESPOND)         → andamento
 *   (aguardando, ASSIGN)         → aguardando
 *   (aguardando, WAIT_REQUESTER) → aguardando
 *   (resolvido, RESOLVE)         → resolvido
 *   (fechado, CLOSE)             → fechado
 *
 * Validates: Requirements 4.9
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";

import { transitionTicketStatus } from "@/lib/ticket-state";
import type { TicketAction, TicketStatus } from "@/types/domain";

/**
 * Pares `(status, action)` cuja transição é idempotente — isto é, a tabela
 * mapeia o par para o próprio `status`. Restringir o gerador a este conjunto
 * garante que o teste mede idempotência sem tropeçar em transições que
 * mudam de estado.
 */
const SELF_LOOP_PAIRS: ReadonlyArray<readonly [TicketStatus, TicketAction]> = [
    ["aberto", "RESPOND"],
    ["andamento", "ASSIGN"],
    ["andamento", "RESPOND"],
    ["aguardando", "ASSIGN"],
    ["aguardando", "WAIT_REQUESTER"],
    ["resolvido", "RESOLVE"],
    ["fechado", "CLOSE"],
];

const selfLoopArb: fc.Arbitrary<readonly [TicketStatus, TicketAction]> =
    fc.constantFrom(...SELF_LOOP_PAIRS);

describe("transitionTicketStatus — Property 5: idempotente em self-loops", () => {
    it("transitionTicketStatus(s, a) === s quando (s, a) é self-loop", () => {
        fc.assert(
            fc.property(selfLoopArb, ([status, action]) => {
                const next = transitionTicketStatus(status, action);
                expect(next).toBe(status);
            }),
        );
    });

    it("transitionTicketStatus(transitionTicketStatus(s, a), a) === s — aplicar a ação duas vezes preserva o estado", () => {
        fc.assert(
            fc.property(selfLoopArb, ([status, action]) => {
                const once = transitionTicketStatus(status, action);
                const twice = transitionTicketStatus(once, action);
                expect(once).toBe(status);
                expect(twice).toBe(status);
            }),
        );
    });
});
