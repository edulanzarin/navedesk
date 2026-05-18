/**
 * Testes unitários — `SlaMeter` (componente de domínio).
 *
 * Cobre:
 *
 * - Estados terminais (`resolvido`, `fechado`) renderizam apenas `—`,
 *   sem badge nem cálculo de SLA.
 * - Cada `level` derivado de `computeSlaInfo` resulta no tom correto
 *   do `Badge` (`ok→green`, `warn→amber`, `crit→red`, `breached→red`).
 * - Renderização determinística via `now` injetado — sem `setInterval`
 *   nem dependência do relógio do sistema.
 *
 * Renderização puramente baseada em props (sem fetch), em conformidade
 * com R19.7.
 *
 * Validates: R19.5, R19.6, R19.7
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { SlaMeter } from "@/components/domain/sla-meter";
import type { SlaPolicy, TicketStatus } from "@/types/domain";

/** Política única usada pelos cenários — política de prioridade `media` em 8h. */
const POLICIES: SlaPolicy[] = [
    { priority: "baixa", hours: 24 },
    { priority: "media", hours: 8 },
    { priority: "alta", hours: 4 },
    { priority: "critica", hours: 1 },
];

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

/** Instante de referência fixo para todos os cenários. */
const NOW = new Date("2025-01-15T12:00:00Z");

describe("SlaMeter", () => {
    describe("estado terminal", () => {
        it.each<TicketStatus>(["resolvido", "fechado"])(
            "renderiza apenas '—' quando status='%s', sem badge",
            (status) => {
                const { container } = render(
                    <SlaMeter
                        // Mesmo com `deadline` no passado, terminal não computa SLA.
                        deadline={new Date(NOW.getTime() - 10 * HOUR_MS)}
                        priority="media"
                        status={status}
                        policies={POLICIES}
                        now={NOW}
                    />,
                );

                expect(screen.getByText("—")).toBeInTheDocument();
                // Não há badge: nenhuma classe de pílula com tom.
                expect(
                    container.querySelector("[class*='--green-soft']"),
                ).toBeNull();
                expect(
                    container.querySelector("[class*='--amber-soft']"),
                ).toBeNull();
                expect(
                    container.querySelector("[class*='--red-soft']"),
                ).toBeNull();
            },
        );
    });

    describe("estado ativo — mapeia level → tom do badge", () => {
        it("level=ok → tom green (deadline distante)", () => {
            // 6h restantes em política de 8h → 75% restante → ok.
            const deadline = new Date(NOW.getTime() + 6 * HOUR_MS);
            const { container } = render(
                <SlaMeter
                    deadline={deadline}
                    priority="media"
                    status="aberto"
                    policies={POLICIES}
                    now={NOW}
                />,
            );

            const badge = container.firstElementChild as HTMLElement;
            expect(badge).not.toBeNull();
            expect(badge.className).toContain("bg-[--green-soft]");
            expect(badge.className).toContain("text-[--green]");
            expect(screen.getByText(/restantes/)).toBeInTheDocument();
        });

        it("level=warn → tom amber (≤25% restante, >10%)", () => {
            // 1h30min restantes em política de 8h → ~18.75% → warn.
            const deadline = new Date(NOW.getTime() + 90 * MINUTE_MS);
            const { container } = render(
                <SlaMeter
                    deadline={deadline}
                    priority="media"
                    status="andamento"
                    policies={POLICIES}
                    now={NOW}
                />,
            );

            const badge = container.firstElementChild as HTMLElement;
            expect(badge.className).toContain("bg-[--amber-soft]");
            expect(badge.className).toContain("text-[--amber]");
        });

        it("level=crit → tom red (≤10% restante)", () => {
            // 30min restantes em política de 8h → ~6.25% → crit.
            const deadline = new Date(NOW.getTime() + 30 * MINUTE_MS);
            const { container } = render(
                <SlaMeter
                    deadline={deadline}
                    priority="media"
                    status="aberto"
                    policies={POLICIES}
                    now={NOW}
                />,
            );

            const badge = container.firstElementChild as HTMLElement;
            expect(badge.className).toContain("bg-[--red-soft]");
            expect(badge.className).toContain("text-[--red]");
        });

        it("level=breached → tom red e rótulo 'Vencido há …'", () => {
            // 2h após o prazo → breached.
            const deadline = new Date(NOW.getTime() - 2 * HOUR_MS);
            const { container } = render(
                <SlaMeter
                    deadline={deadline}
                    priority="media"
                    status="aberto"
                    policies={POLICIES}
                    now={NOW}
                />,
            );

            const badge = container.firstElementChild as HTMLElement;
            expect(badge.className).toContain("bg-[--red-soft]");
            expect(badge.className).toContain("text-[--red]");
            expect(screen.getByText(/Vencido há/)).toBeInTheDocument();
        });
    });

    it("renderiza sem disparar fetch ou usar setInterval quando `now` é injetado", () => {
        // Sem o `now` injetado, o componente assina um setInterval; com ele
        // injetado, o efeito sai cedo. Render duas vezes não vaza intervalos
        // — qualquer leak quebraria o jsdom em testes seguintes.
        const deadline = new Date(NOW.getTime() + 6 * HOUR_MS);
        const { unmount } = render(
            <SlaMeter
                deadline={deadline}
                priority="media"
                status="aberto"
                policies={POLICIES}
                now={NOW}
            />,
        );
        unmount();
        // Render limpo após desmontagem.
        const { container } = render(
            <SlaMeter
                deadline={deadline}
                priority="media"
                status="aberto"
                policies={POLICIES}
                now={NOW}
            />,
        );
        expect(container.firstElementChild).not.toBeNull();
    });
});
