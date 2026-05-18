/**
 * Property 6 — `fechado` é absorvente.
 *
 * Para qualquer ação `a ∉ {REOPEN, CLOSE}`,
 * `transitionTicketStatus("fechado", a)` lança
 * `IllegalStateTransitionError`. As únicas saídas legais a partir de
 * `fechado` são REOPEN (que leva a `aberto`) e CLOSE (idempotente).
 *
 * **Validates: Requirements 4.8**
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { TICKET_ACTIONS } from "@/lib/constants";
import {
    IllegalStateTransitionError,
    transitionTicketStatus,
} from "@/lib/ticket-state";
import type { TicketAction } from "@/types/domain";

const ABSORBING_BLOCKED_ACTIONS = TICKET_ACTIONS.filter(
    (action): action is Exclude<TicketAction, "REOPEN" | "CLOSE"> =>
        action !== "REOPEN" && action !== "CLOSE",
);

describe("Property 6: `fechado` é absorvente", () => {
    it("rejeita qualquer ação fora de {REOPEN, CLOSE} a partir de fechado", () => {
        fc.assert(
            fc.property(
                fc.constantFrom(...ABSORBING_BLOCKED_ACTIONS),
                (action) => {
                    let caught: unknown;
                    try {
                        transitionTicketStatus("fechado", action);
                    } catch (err) {
                        caught = err;
                    }

                    expect(caught).toBeInstanceOf(IllegalStateTransitionError);
                    const error = caught as IllegalStateTransitionError;
                    expect(error.current).toBe("fechado");
                    expect(error.action).toBe(action);
                },
            ),
        );
    });

    it("REOPEN a partir de fechado retorna aberto", () => {
        expect(transitionTicketStatus("fechado", "REOPEN")).toBe("aberto");
    });

    it("CLOSE a partir de fechado é idempotente e retorna fechado", () => {
        expect(transitionTicketStatus("fechado", "CLOSE")).toBe("fechado");
    });
});
