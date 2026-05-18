/**
 * Property-Based Test — Property 4: transição é total no domínio válido.
 *
 * `transitionTicketStatus` é uma função total sobre `TicketStatus × TicketAction`:
 *
 * - Para todo par `(status, action)` aceito pela tabela do design, retorna o
 *   `TicketStatus` esperado.
 * - Para todo par marcado com `—`, lança `IllegalStateTransitionError`
 *   carregando `current` e `action` originais.
 *
 * Tabela de referência (design / `src/lib/ticket-state.ts`):
 *
 * | Estado     | ASSIGN     | WAIT_REQUESTER | RESPOND    | RESOLVE   | REOPEN | CLOSE   |
 * | ---------- | ---------- | -------------- | ---------- | --------- | ------ | ------- |
 * | aberto     | andamento  | aguardando     | aberto     | resolvido | —      | fechado |
 * | andamento  | andamento  | aguardando     | andamento  | resolvido | —      | fechado |
 * | aguardando | aguardando | aguardando     | andamento  | resolvido | —      | fechado |
 * | resolvido  | —          | —              | andamento  | resolvido | aberto | fechado |
 * | fechado    | —          | —              | —          | —         | aberto | fechado |
 *
 * Validates: Requirements 4.8, 4.9
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";

import {
    transitionTicketStatus,
    IllegalStateTransitionError,
} from "@/lib/ticket-state";
import { STATUSES, TICKET_ACTIONS } from "@/lib/constants";
import type { TicketAction, TicketStatus } from "@/types/domain";

/**
 * Fixture explícita da tabela de transições aceitas. `null` representa as
 * células marcadas com `—` no design (transições proibidas que devem
 * lançar `IllegalStateTransitionError`). Mantida como cópia textual da
 * tabela para servir como oráculo independente da implementação.
 */
const EXPECTED: Record<
    TicketStatus,
    Record<TicketAction, TicketStatus | null>
> = {
    aberto: {
        ASSIGN: "andamento",
        WAIT_REQUESTER: "aguardando",
        RESPOND: "aberto",
        RESOLVE: "resolvido",
        REOPEN: null,
        CLOSE: "fechado",
    },
    andamento: {
        ASSIGN: "andamento",
        WAIT_REQUESTER: "aguardando",
        RESPOND: "andamento",
        RESOLVE: "resolvido",
        REOPEN: null,
        CLOSE: "fechado",
    },
    aguardando: {
        ASSIGN: "aguardando",
        WAIT_REQUESTER: "aguardando",
        RESPOND: "andamento",
        RESOLVE: "resolvido",
        REOPEN: null,
        CLOSE: "fechado",
    },
    resolvido: {
        ASSIGN: null,
        WAIT_REQUESTER: null,
        RESPOND: "andamento",
        RESOLVE: "resolvido",
        REOPEN: "aberto",
        CLOSE: "fechado",
    },
    fechado: {
        ASSIGN: null,
        WAIT_REQUESTER: null,
        RESPOND: null,
        RESOLVE: null,
        REOPEN: "aberto",
        CLOSE: "fechado",
    },
};

/** Gera qualquer status válido do domínio. */
const statusArb: fc.Arbitrary<TicketStatus> = fc.constantFrom(...STATUSES);

/** Gera qualquer ação válida do domínio. */
const actionArb: fc.Arbitrary<TicketAction> = fc.constantFrom(
    ...TICKET_ACTIONS,
);

/**
 * Gera o produto cartesiano `TicketStatus × TicketAction` via `oneof` —
 * cada combinação tem probabilidade ≈ 1/30 de ser amostrada. `numRuns` >> 30
 * garante cobertura prática de todas as células da tabela em uma única
 * execução.
 */
const pairArb: fc.Arbitrary<[TicketStatus, TicketAction]> = fc.oneof(
    fc.tuple(statusArb, actionArb),
);

describe("transitionTicketStatus — Property 4: total no domínio válido", () => {
    it("para todo (status, action) aceito retorna o TicketStatus esperado; para os marcados — lança IllegalStateTransitionError", () => {
        fc.assert(
            fc.property(pairArb, ([status, action]) => {
                const expected = EXPECTED[status][action];

                if (expected === null) {
                    expect(() => transitionTicketStatus(status, action)).toThrow(
                        IllegalStateTransitionError,
                    );
                    // Confirma que o erro carrega `current` e `action` originais
                    // (R4.8): permite mensagens precisas e telemetria.
                    try {
                        transitionTicketStatus(status, action);
                    } catch (err) {
                        expect(err).toBeInstanceOf(IllegalStateTransitionError);
                        const e = err as IllegalStateTransitionError;
                        expect(e.current).toBe(status);
                        expect(e.action).toBe(action);
                    }
                } else {
                    const next = transitionTicketStatus(status, action);
                    expect(next).toBe(expected);
                }
            }),
            { numRuns: 1000 },
        );
    });

    it("cobre exaustivamente todas as 30 células da tabela (oráculo independente da amostragem)", () => {
        for (const status of STATUSES) {
            for (const action of TICKET_ACTIONS) {
                const expected = EXPECTED[status][action];

                if (expected === null) {
                    expect(() => transitionTicketStatus(status, action)).toThrow(
                        IllegalStateTransitionError,
                    );
                } else {
                    expect(transitionTicketStatus(status, action)).toBe(expected);
                }
            }
        }
    });
});
