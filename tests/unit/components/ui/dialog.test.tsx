/**
 * Testes unitários — `Dialog` (primitivo de UI).
 *
 * Cobre render quando aberto, presença de role="dialog", título acessível,
 * descrição vinculada e botão de fechar com aria-label="Fechar".
 *
 * Validates: R19.3
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

function OpenDialog() {
    return (
        <Dialog open>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Confirmar ação</DialogTitle>
                    <DialogDescription>
                        Tem certeza de que deseja prosseguir?
                    </DialogDescription>
                </DialogHeader>
                <p>Conteúdo do diálogo.</p>
            </DialogContent>
        </Dialog>
    );
}

describe("Dialog", () => {
    it("renderiza com role='dialog' quando aberto", () => {
        render(<OpenDialog />);

        const dialog = screen.getByRole("dialog");
        expect(dialog).toBeInTheDocument();
    });

    it("expõe o título via DialogTitle", () => {
        render(<OpenDialog />);

        expect(
            screen.getByText("Confirmar ação"),
        ).toBeInTheDocument();
    });

    it("expõe a descrição via DialogDescription", () => {
        render(<OpenDialog />);

        expect(
            screen.getByText("Tem certeza de que deseja prosseguir?"),
        ).toBeInTheDocument();
    });

    it("possui botão de fechar com aria-label='Fechar'", () => {
        render(<OpenDialog />);

        const closeBtn = screen.getByRole("button", { name: "Fechar" });
        expect(closeBtn).toBeInTheDocument();
    });

    it("vincula o título ao dialog via aria-labelledby", () => {
        render(<OpenDialog />);

        const dialog = screen.getByRole("dialog");
        const labelledBy = dialog.getAttribute("aria-labelledby");
        expect(labelledBy).toBeTruthy();

        const title = screen.getByText("Confirmar ação");
        expect(title.id).toBe(labelledBy);
    });
});
