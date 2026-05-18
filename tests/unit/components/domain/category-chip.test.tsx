/**
 * Testes unitários — `CategoryChip` (componente de domínio).
 *
 * Garante:
 *
 * - Renderiza o rótulo principal e, quando informado, o subtítulo
 *   separado pelo middle-dot.
 * - Renderiza um ícone SVG (Lucide) à esquerda — fallback para `Tag`
 *   quando o nome não está na allowlist.
 *
 * Renderização puramente baseada em props (sem fetch), em conformidade
 * com R19.7.
 *
 * Validates: R19.7
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { CategoryChip } from "@/components/domain/category-chip";

describe("CategoryChip", () => {
    it("renderiza rótulo principal e ícone SVG", () => {
        const { container } = render(
            <CategoryChip icon="monitor" label="Hardware" />,
        );

        expect(screen.getByText("Hardware")).toBeInTheDocument();

        const svg = container.querySelector("svg");
        expect(svg).not.toBeNull();
        // Ícone é decorativo — não deve ser anunciado.
        expect(svg).toHaveAttribute("aria-hidden", "true");
    });

    it("renderiza subtítulo (sub) precedido por middle-dot quando informado", () => {
        render(
            <CategoryChip
                icon="package"
                label="Hardware"
                sub="Periféricos"
            />,
        );

        expect(screen.getByText("Hardware")).toBeInTheDocument();
        expect(screen.getByText("Periféricos")).toBeInTheDocument();
        // Middle-dot decorativo (entre rótulo e sub).
        expect(screen.getByText(/·/)).toBeInTheDocument();
    });

    it("não renderiza middle-dot quando `sub` é omitido", () => {
        render(<CategoryChip icon="cog" label="Sistema" />);

        expect(screen.getByText("Sistema")).toBeInTheDocument();
        expect(screen.queryByText(/·/)).toBeNull();
    });

    it("usa o ícone fallback (Tag) para nomes fora da allowlist sem quebrar o render", () => {
        const { container } = render(
            <CategoryChip icon="naoexiste" label="Genérico" />,
        );

        // Mesmo com nome inválido, ainda há um SVG renderizado (fallback Tag).
        const svg = container.querySelector("svg");
        expect(svg).not.toBeNull();
        expect(screen.getByText("Genérico")).toBeInTheDocument();
    });
});
