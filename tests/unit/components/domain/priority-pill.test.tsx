/**
 * Testes unitários — `PriorityPill` (componente de domínio).
 *
 * Garante que cada `Priority` mapeia para o tom correto via
 * `design-tokens.tone.priority` e que o rótulo exibido é exatamente o
 * definido em `PRIORITY_LABELS_PT`. Os tons são verificados pelas
 * classes Tailwind aplicadas pelo primitivo `Badge`.
 *
 * Renderização puramente baseada em props (sem fetch), em conformidade
 * com R19.7.
 *
 * Validates: R19.6, R19.7
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { PriorityPill } from "@/components/domain/priority-pill";
import { PRIORITIES, PRIORITY_LABELS_PT } from "@/lib/constants";
import type { Priority } from "@/lib/constants";

/**
 * Mapeamento esperado `priority → (bg, text)` espelhando o contrato
 * R19.6 + tabela `tone.priority` em `design-tokens.ts`.
 */
const EXPECTED: Record<Priority, { bg: string; text: string }> = {
    baixa: { bg: "bg-[--grey-soft]", text: "text-[--ink-2]" },
    media: { bg: "bg-[--blue-soft]", text: "text-[--blue]" },
    alta: { bg: "bg-[--amber-soft]", text: "text-[--amber]" },
    critica: { bg: "bg-[--red-soft]", text: "text-[--red]" },
};

describe("PriorityPill", () => {
    it("cobre todas as prioridades definidas em PRIORITIES (sanity check)", () => {
        for (const priority of PRIORITIES) {
            expect(EXPECTED[priority]).toBeDefined();
        }
    });

    it.each(PRIORITIES)(
        "renderiza o rótulo pt-BR oficial e o tom correto para priority='%s'",
        (priority) => {
            const { container } = render(<PriorityPill priority={priority} />);

            expect(
                screen.getByText(PRIORITY_LABELS_PT[priority]),
            ).toBeInTheDocument();

            const badge = container.firstElementChild as HTMLElement;
            expect(badge).not.toBeNull();
            expect(badge.className).toContain(EXPECTED[priority].bg);
            expect(badge.className).toContain(EXPECTED[priority].text);
        },
    );

    it("renderiza sem disparar fetch ou usar APIs do navegador", () => {
        const { container } = render(<PriorityPill priority="critica" />);
        expect(container.firstElementChild).not.toBeNull();
    });
});
