/**
 * Testes unitários — `Button` (primitivo de UI).
 *
 * Cobre render básico, atributos de acessibilidade (`role`, `aria-busy`),
 * comportamento de clique, estado `loading` (spinner + disabled) e
 * composição via `asChild`.
 *
 * Validates: R19.3
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { Button } from "@/components/ui/button";

describe("Button", () => {
    it("renderiza um <button> com role='button' e a label", () => {
        render(<Button>Salvar</Button>);

        const btn = screen.getByRole("button", { name: "Salvar" });
        expect(btn).toBeInTheDocument();
        expect(btn.tagName).toBe("BUTTON");
        // Tipo padrão é "button" (não "submit") para evitar submits acidentais.
        expect(btn).toHaveAttribute("type", "button");
    });

    it("dispara onClick quando clicado", () => {
        const onClick = vi.fn();
        render(<Button onClick={onClick}>Clique</Button>);

        fireEvent.click(screen.getByRole("button", { name: "Clique" }));

        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it("quando loading=true mostra o spinner com data-testid e marca como disabled + aria-busy", () => {
        render(<Button loading>Enviando</Button>);

        const btn = screen.getByRole("button", { name: /enviando/i });
        expect(btn).toBeDisabled();
        expect(btn).toHaveAttribute("aria-busy", "true");

        const spinner = screen.getByTestId("button-spinner");
        expect(spinner).toBeInTheDocument();
        // Spinner é decorativo — esconde-se de assistive tech.
        expect(spinner).toHaveAttribute("aria-hidden", "true");
    });

    it("não dispara onClick quando loading=true", () => {
        const onClick = vi.fn();
        render(
            <Button loading onClick={onClick}>
                Enviando
            </Button>,
        );

        fireEvent.click(screen.getByRole("button", { name: /enviando/i }));

        expect(onClick).not.toHaveBeenCalled();
    });

    it("respeita disabled=true", () => {
        render(<Button disabled>Indisponível</Button>);

        const btn = screen.getByRole("button", { name: "Indisponível" });
        expect(btn).toBeDisabled();
    });

    it("asChild compõe o filho preservando classes e atributos", () => {
        render(
            <Button asChild variant="primary" size="lg" className="extra">
                <a href="/destino">Ir para destino</a>
            </Button>,
        );

        const link = screen.getByRole("link", { name: "Ir para destino" });
        expect(link).toBeInTheDocument();
        expect(link).toHaveAttribute("href", "/destino");
        // Classe customizada aplicada via Slot.
        expect(link.className).toContain("extra");
    });

    it("snapshot de variantes principais (primary md)", () => {
        const { container } = render(
            <Button variant="primary" size="md">
                Confirmar
            </Button>,
        );
        expect(container.firstChild).toMatchSnapshot();
    });
});
