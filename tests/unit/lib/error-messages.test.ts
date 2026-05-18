/**
 * Testes unitários para o módulo `error-messages`, que centraliza as
 * mensagens em pt-BR usadas por toasts e UI consumers quando uma
 * Server Action ou Route Handler retorna falha.
 *
 * Validates: Requirements R20.1, R22.1, R22.2, R22.3.
 */

import { describe, expect, it } from "vitest";

import {
    DEFAULT_ERROR_MESSAGE,
    ERROR_MESSAGES,
    getErrorMessage,
} from "@/lib/error-messages";

describe("ERROR_MESSAGES map", () => {
    /**
     * Códigos efetivamente emitidos pelos services e route handlers do
     * NaveDesk. Se um novo código for introduzido sem entrada no mapa,
     * este teste falha — forçando a UI a nunca cair no fallback
     * genérico para um código que conhecemos.
     */
    const KNOWN_CODES = [
        "UNAUTHORIZED",
        "FORBIDDEN",
        "INVALID_CREDENTIALS",
        "RATE_LIMITED",
        "VALIDATION",
        "VALIDATION_ERROR",
        "NOT_FOUND",
        "CONFLICT",
        "IN_USE",
        "INVALID_TRANSITION",
        "ILLEGAL_TRANSITION",
        "INVALID_ASSIGNEE",
        "ATTACHMENT_INVALID",
        "TOO_MANY_ROWS",
        "NOT_IMPLEMENTED",
        "INVALID_MULTIPART",
        "FILE_REQUIRED",
        "TOO_LARGE",
        "EMPTY_FILE",
        "UNSUPPORTED_MIME",
        "MIME_MISMATCH",
        "MIME_UNDETECTABLE",
    ];

    it.each(KNOWN_CODES)(
        "tem entrada em pt-BR para o código %s",
        (code) => {
            const message = ERROR_MESSAGES[code];
            expect(message).toBeDefined();
            expect(message?.length ?? 0).toBeGreaterThan(0);
        },
    );
});

describe("getErrorMessage", () => {
    it("prefere a mensagem do servidor quando ela existe", () => {
        const error = {
            code: "VALIDATION",
            message: "O campo email é obrigatório.",
        };
        expect(getErrorMessage(error)).toBe("O campo email é obrigatório.");
    });

    it("ignora mensagem do servidor que é apenas espaços em branco", () => {
        const error = { code: "FORBIDDEN", message: "   " };
        expect(getErrorMessage(error)).toBe(ERROR_MESSAGES.FORBIDDEN);
    });

    it("usa o mapa quando o servidor não envia mensagem", () => {
        const error = { code: "NOT_FOUND" };
        expect(getErrorMessage(error)).toBe(ERROR_MESSAGES.NOT_FOUND);
    });

    it("usa o mapa quando a mensagem do servidor é null", () => {
        const error = { code: "UNAUTHORIZED", message: null };
        expect(getErrorMessage(error)).toBe(ERROR_MESSAGES.UNAUTHORIZED);
    });

    it("cai no fallback genérico para código desconhecido sem mensagem", () => {
        const error = { code: "TOTALLY_UNKNOWN_CODE" };
        expect(getErrorMessage(error)).toBe(DEFAULT_ERROR_MESSAGE);
    });

    it("retorna o fallback quando recebe null", () => {
        expect(getErrorMessage(null)).toBe(DEFAULT_ERROR_MESSAGE);
    });

    it("retorna o fallback quando recebe undefined", () => {
        expect(getErrorMessage(undefined)).toBe(DEFAULT_ERROR_MESSAGE);
    });

    it("trima a mensagem do servidor antes de devolver", () => {
        const error = {
            code: "VALIDATION",
            message: "  Senha muito curta.  ",
        };
        expect(getErrorMessage(error)).toBe("Senha muito curta.");
    });
});
