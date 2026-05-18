/**
 * Testes unitários — `KpiCard` (componente de domínio).
 *
 * Cobre:
 *
 * - Render do `label`, do `value` e da `unit` opcional.
 * - Render do bloco de `delta` com ícone (`up` em verde, `down` em
 *   vermelho), valor numérico e rótulo de referência.
 * - Render do sparkline SVG quando `spark` é informado.
 *
 * Renderização puramente baseada em props (sem fetch), em conformidade
 * com R19.7.
 *
 * Validates: R19.7
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { KpiCard } from "@/components/domain/kpi-card";

describe("KpiCard", () => {
    it("renderiza label e value", () => {
        render(<KpiCard label="Tickets abertos" value={42} />);

        expect(screen.getByText("Tickets abertos")).toBeInTheDocument();
        expect(screen.getByText("42")).toBeInTheDocument();
    });

    it("renderiza a `unit` opcional adjacente ao value", () => {
        render(<KpiCard label="Tempo médio" value="3.5" unit="h" />);

        expect(screen.getByText("3.5")).toBeInTheDocument();
        expect(screen.getByText("h")).toBeInTheDocument();
    });

    it("não renderiza unit quando omitida", () => {
        render(<KpiCard label="Total" value={10} />);

        // Nenhum <span> com texto isolado de unidade.
        expect(screen.queryByText("h")).toBeNull();
    });

    it("renderiza delta com direção 'up' em verde e ícone TrendingUp", () => {
        const { container } = render(
            <KpiCard
                label="Resolvidos"
                value={120}
                delta={{ value: 12, direction: "up", reference: "vs ontem" }}
            />,
        );

        // Valor numérico do delta, rótulo de referência, e classe do bloco.
        expect(screen.getByText("12")).toBeInTheDocument();
        expect(screen.getByText("vs ontem")).toBeInTheDocument();

        const deltaBlock = container.querySelector(".text-\\[--green\\]");
        expect(deltaBlock).not.toBeNull();
        // SVG decorativo do ícone está dentro do bloco verde.
        expect(deltaBlock?.querySelector("svg")).not.toBeNull();
    });

    it("renderiza delta com direção 'down' em vermelho e ícone TrendingDown", () => {
        const { container } = render(
            <KpiCard
                label="Reabertos"
                value={3}
                delta={{ value: 1, direction: "down", reference: "vs ontem" }}
            />,
        );

        expect(screen.getByText("1")).toBeInTheDocument();
        expect(screen.getByText("vs ontem")).toBeInTheDocument();

        const deltaBlock = container.querySelector(".text-\\[--red\\]");
        expect(deltaBlock).not.toBeNull();
        expect(deltaBlock?.querySelector("svg")).not.toBeNull();
    });

    it("não renderiza bloco de delta quando `delta` é omitido", () => {
        const { container } = render(<KpiCard label="Total" value={5} />);

        expect(container.querySelector(".text-\\[--green\\]")).toBeNull();
        expect(container.querySelector(".text-\\[--red\\]")).toBeNull();
    });

    it("renderiza sparkline SVG quando `spark` é informado", () => {
        const { container } = render(
            <KpiCard
                label="Tendência"
                value={7}
                spark={[1, 2, 3, 4, 5]}
            />,
        );

        const svg = container.querySelector("svg[viewBox]");
        expect(svg).not.toBeNull();
        // SVG do sparkline é decorativo.
        expect(svg).toHaveAttribute("aria-hidden", "true");
        // Tem ao menos um <path> (linha + área de preenchimento).
        const paths = svg?.querySelectorAll("path");
        expect(paths?.length).toBeGreaterThan(0);
    });

    it("não renderiza sparkline quando `spark` é vazio ou omitido", () => {
        const { container: c1 } = render(<KpiCard label="A" value={1} />);
        expect(c1.querySelector("svg[viewBox]")).toBeNull();

        const { container: c2 } = render(
            <KpiCard label="B" value={2} spark={[]} />,
        );
        expect(c2.querySelector("svg[viewBox]")).toBeNull();
    });
});
