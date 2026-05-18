/**
 * Testes unitários — `AttachmentChip` (componente de domínio).
 *
 * Cobre:
 *
 * - Render do nome, tamanho formatado (`B/KB/MB`) e ícone derivado do
 *   MIME — `image/*` e `application/pdf` resolvem para ícones distintos.
 * - Quando `href` é informado, o corpo vira `<a>` com `download`.
 * - Quando `onRemove` é informado, exibe um botão `X` acessível que
 *   dispara o callback com o `id` do anexo.
 *
 * Renderização puramente baseada em props (sem fetch), em conformidade
 * com R19.7.
 *
 * Validates: R19.7
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { AttachmentChip } from "@/components/domain/attachment-chip";

describe("AttachmentChip", () => {
    it("renderiza nome e tamanho formatado", () => {
        render(
            <AttachmentChip
                id="a1"
                name="relatorio.pdf"
                size={2 * 1024 * 1024}
                mime="application/pdf"
            />,
        );

        expect(screen.getByText("relatorio.pdf")).toBeInTheDocument();
        expect(screen.getByText("2.0 MB")).toBeInTheDocument();
    });

    it("escolhe ícones distintos para image/* e application/pdf", () => {
        const { container: imgContainer } = render(
            <AttachmentChip
                id="img"
                name="foto.png"
                size={2048}
                mime="image/png"
            />,
        );
        const imgSvg = imgContainer.querySelector("svg");
        expect(imgSvg).not.toBeNull();

        const { container: pdfContainer } = render(
            <AttachmentChip
                id="pdf"
                name="doc.pdf"
                size={2048}
                mime="application/pdf"
            />,
        );
        const pdfSvg = pdfContainer.querySelector("svg");
        expect(pdfSvg).not.toBeNull();

        // SVGs do Lucide carregam o nome do ícone na classe — garante que o
        // mapeamento por MIME produz componentes diferentes.
        expect(imgSvg?.getAttribute("class")).not.toBe(
            pdfSvg?.getAttribute("class"),
        );
    });

    it("renderiza <a download> quando `href` é informado", () => {
        render(
            <AttachmentChip
                id="a1"
                name="anexo.pdf"
                size={1024}
                mime="application/pdf"
                href="/api/uploads/a1"
            />,
        );

        const link = screen.getByRole("link");
        expect(link).toHaveAttribute("href", "/api/uploads/a1");
        expect(link).toHaveAttribute("download", "anexo.pdf");
    });

    it("não renderiza link quando `href` é omitido", () => {
        render(
            <AttachmentChip
                id="a1"
                name="anexo.pdf"
                size={1024}
                mime="application/pdf"
            />,
        );

        expect(screen.queryByRole("link")).toBeNull();
    });

    it("renderiza botão X com aria-label e dispara onRemove com o id", () => {
        const onRemove = vi.fn();
        render(
            <AttachmentChip
                id="a42"
                name="anexo.pdf"
                size={1024}
                mime="application/pdf"
                onRemove={onRemove}
            />,
        );

        const btn = screen.getByRole("button", {
            name: /Remover anexo anexo\.pdf/,
        });
        fireEvent.click(btn);

        expect(onRemove).toHaveBeenCalledTimes(1);
        expect(onRemove).toHaveBeenCalledWith("a42");
    });

    it("não renderiza botão X quando `onRemove` é omitido", () => {
        render(
            <AttachmentChip
                id="a1"
                name="anexo.pdf"
                size={1024}
                mime="application/pdf"
            />,
        );

        expect(screen.queryByRole("button")).toBeNull();
    });
});
