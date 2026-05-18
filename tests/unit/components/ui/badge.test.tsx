/**
 * Testes unitários — `Badge` (primitivo de UI).
 *
 * Cobre render dos children, presença/ausência do ponto colorido conforme
 * `withDot` e atributos de acessibilidade do ponto (decorativo).
 *
 * Validates: R19.3
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { Badge } from "@/components/ui/badge";
import type { BadgeTone } from "@/lib/design-tokens";

describe("Badge", () => {
    it("renderiza os children", () => {
        render(<Badge>Aberto</Badge>);
        expect(screen.getByText("Aberto")).toBeInTheDocument();
    });

    it("withDot=true (default) renderiza o ponto colorido com aria-hidden", () => {
        const { container } = render(<Badge tone="green">Resolvido</Badge>);

        const dot = container.querySelector("span[aria-hidden='true']");
        expect(dot).not.toBeNull();
        // Ponto é o primeiro filho (antes da label).
        expect(dot?.className).toContain("rounded-full");
    });

    it("withDot=false não renderiza o ponto", () => {
        const { container } = render(
            <Badge tone="blue" withDot={false}>
                Info
            </Badge>,
        );

        const dot = container.querySelector("span[aria-hidden='true']");
        expect(dot).toBeNull();
        expect(screen.getByText("Info")).toBeInTheDocument();
    });

    it.each<BadgeTone>(["indigo", "blue", "green", "amber", "red", "grey"])(
        "aceita o tom '%s' sem quebrar o render",
        (tone) => {
            render(<Badge tone={tone}>Tom {tone}</Badge>);
            expect(screen.getByText(`Tom ${tone}`)).toBeInTheDocument();
        },
    );

    it("repassa atributos arbitrários (role, aria-label) para o <span>", () => {
        render(
            <Badge tone="amber" role="status" aria-label="Em andamento">
                Em andamento
            </Badge>,
        );

        const el = screen.getByRole("status", { name: "Em andamento" });
        expect(el).toBeInTheDocument();
    });

    it("snapshot de tom green com dot", () => {
        const { container } = render(
            <Badge tone="green">Resolvido</Badge>,
        );
        expect(container.firstChild).toMatchSnapshot();
    });
});
