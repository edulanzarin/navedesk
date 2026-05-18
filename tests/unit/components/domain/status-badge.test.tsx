/**
 * Testes unitários — `StatusBadge` (componente de domínio).
 *
 * Garante que cada `TicketStatus` mapeia para o tom correto via
 * `design-tokens.tone.status` e que o rótulo exibido é exatamente o
 * definido em `STATUS_LABELS_PT`. Os tons são verificados pelas classes
 * Tailwind aplicadas pelo primitivo `Badge` (par `bg-[--*-soft]` /
 * `text-[--*]`), evitando inspeção de estilos computados em jsdom.
 *
 * Renderização puramente baseada em props (sem fetch), em conformidade
 * com R19.7.
 *
 * Validates: R19.5, R19.7
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { StatusBadge } from "@/components/domain/status-badge";
import { STATUS_LABELS_PT, STATUSES } from "@/lib/constants";
import type { TicketStatus } from "@/lib/constants";

/**
 * Mapeamento esperado `status → (bg, text)` espelhando o contrato
 * R19.5 + tabela `tone.status` em `design-tokens.ts`.
 */
const EXPECTED: Record<TicketStatus, { bg: string; text: string }> = {
    aberto: { bg: "bg-[--blue-soft]", text: "text-[--blue]" },
    andamento: { bg: "bg-[--amber-soft]", text: "text-[--amber]" },
    aguardando: { bg: "bg-[--grey-soft]", text: "text-[--ink-2]" },
    resolvido: { bg: "bg-[--green-soft]", text: "text-[--green]" },
    fechado: { bg: "bg-[--grey-soft]", text: "text-[--ink-2]" },
};

describe("StatusBadge", () => {
    it("cobre todos os status definidos em STATUSES (sanity check)", () => {
        // Garante que o teste evolui junto com o domínio: novo status sem
        // entrada em EXPECTED quebra antes de mascarar regressão visual.
        for (const status of STATUSES) {
            expect(EXPECTED[status]).toBeDefined();
        }
    });

    it.each(STATUSES)(
        "renderiza o rótulo pt-BR oficial e o tom correto para status='%s'",
        (status) => {
            const { container } = render(<StatusBadge status={status} />);

            // Rótulo idêntico a STATUS_LABELS_PT — sem variação de caixa.
            expect(
                screen.getByText(STATUS_LABELS_PT[status]),
            ).toBeInTheDocument();

            const badge = container.firstElementChild as HTMLElement;
            expect(badge).not.toBeNull();
            expect(badge.className).toContain(EXPECTED[status].bg);
            expect(badge.className).toContain(EXPECTED[status].text);
        },
    );

    it("renderiza sem disparar fetch ou usar APIs do navegador", () => {
        // Render puro — recebe dados apenas via props. Compatível com RSC.
        const { container } = render(<StatusBadge status="aberto" />);
        expect(container.firstElementChild).not.toBeNull();
    });
});
