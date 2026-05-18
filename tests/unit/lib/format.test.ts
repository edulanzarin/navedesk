/**
 * Testes unitários para os formatadores de datas e durações em pt-BR.
 *
 * Validates: Requirements R20.3
 */

import { describe, expect, it } from "vitest";

import { fmtDate, fmtDateTime, fmtDuration, relTime } from "@/lib/format";

describe("fmtDate", () => {
    it("formata uma data com mês abreviado em pt-BR", () => {
        // 12 de janeiro de 2025
        const d = new Date(2025, 0, 12, 14, 30, 0);
        expect(fmtDate(d)).toBe("12 de jan de 2025");
    });

    it("usa abreviações pt-BR para todos os meses", () => {
        const expectedMonths = [
            "jan",
            "fev",
            "mar",
            "abr",
            "mai",
            "jun",
            "jul",
            "ago",
            "set",
            "out",
            "nov",
            "dez",
        ];

        for (let m = 0; m < 12; m++) {
            const d = new Date(2025, m, 5, 12, 0, 0);
            expect(fmtDate(d)).toBe(`5 de ${expectedMonths[m]} de 2025`);
        }
    });

    it("não aplica zero-padding ao dia", () => {
        const d = new Date(2025, 5, 3, 9, 0, 0);
        expect(fmtDate(d)).toBe("3 de jun de 2025");
    });
});

describe("fmtDateTime", () => {
    it("formata data e hora com 'às' e HH:mm em pt-BR", () => {
        const d = new Date(2025, 0, 12, 14, 30, 0);
        expect(fmtDateTime(d)).toBe("12 de jan de 2025 às 14:30");
    });

    it("usa zero-padding para horas e minutos", () => {
        const d = new Date(2025, 7, 1, 9, 5, 0);
        expect(fmtDateTime(d)).toBe("1 de ago de 2025 às 09:05");
    });
});

describe("relTime", () => {
    // `now` fixo para manter os testes determinísticos.
    const now = new Date(2025, 0, 12, 14, 30, 0);

    it("retorna 'há cerca de 2 horas' para uma data 2h no passado", () => {
        const d = new Date(now.getTime() - 2 * 60 * 60 * 1000);
        expect(relTime(d, now)).toBe("há cerca de 2 horas");
    });

    it("retorna 'há 30 minutos' para 30 minutos no passado", () => {
        const d = new Date(now.getTime() - 30 * 60 * 1000);
        expect(relTime(d, now)).toBe("há 30 minutos");
    });

    it("retorna 'em 30 minutos' para 30 minutos no futuro", () => {
        const d = new Date(now.getTime() + 30 * 60 * 1000);
        expect(relTime(d, now)).toBe("em 30 minutos");
    });

    it("retorna 'em cerca de 2 horas' para 2h no futuro", () => {
        const d = new Date(now.getTime() + 2 * 60 * 60 * 1000);
        expect(relTime(d, now)).toBe("em cerca de 2 horas");
    });

    it("retorna 'há 1 dia' para 24h no passado", () => {
        const d = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        expect(relTime(d, now)).toBe("há 1 dia");
    });

    it("usa expressão pt-BR para diferenças menores que 1 minuto", () => {
        const d = new Date(now.getTime() - 5 * 1000);
        expect(relTime(d, now)).toBe("há menos de um minuto");
    });
});

describe("fmtDuration", () => {
    it("retorna '0s' para zero", () => {
        expect(fmtDuration(0)).toBe("0s");
    });

    it("retorna '0s' para valores negativos", () => {
        expect(fmtDuration(-1)).toBe("0s");
        expect(fmtDuration(-1000)).toBe("0s");
        expect(fmtDuration(-1_000_000)).toBe("0s");
    });

    it("retorna '0s' para valores não-finitos", () => {
        expect(fmtDuration(Number.NaN)).toBe("0s");
        expect(fmtDuration(Number.POSITIVE_INFINITY)).toBe("0s");
        expect(fmtDuration(Number.NEGATIVE_INFINITY)).toBe("0s");
    });

    it("formata segundos quando menor que 1 minuto", () => {
        expect(fmtDuration(30 * 1000)).toBe("30s");
        expect(fmtDuration(1 * 1000)).toBe("1s");
        expect(fmtDuration(59 * 1000)).toBe("59s");
    });

    it("trunca frações de milissegundo ao formatar segundos", () => {
        expect(fmtDuration(30 * 1000 + 999)).toBe("30s");
    });

    it("formata exatamente 1 minuto como '1min'", () => {
        expect(fmtDuration(60 * 1000)).toBe("1min");
    });

    it("formata minutos quando menor que 1 hora", () => {
        expect(fmtDuration(5 * 60 * 1000)).toBe("5min");
        expect(fmtDuration(59 * 60 * 1000)).toBe("59min");
    });

    it("formata 90 minutos como '1h 30min'", () => {
        expect(fmtDuration(90 * 60 * 1000)).toBe("1h 30min");
    });

    it("formata exatamente 1 hora como '1h' (omite 0min)", () => {
        expect(fmtDuration(60 * 60 * 1000)).toBe("1h");
    });

    it("formata 26 horas como '1d 2h'", () => {
        expect(fmtDuration(26 * 60 * 60 * 1000)).toBe("1d 2h");
    });

    it("formata exatamente 1 dia como '1d' (omite 0h)", () => {
        expect(fmtDuration(24 * 60 * 60 * 1000)).toBe("1d");
    });

    it("formata múltiplos dias com horas", () => {
        // 3 dias e 5 horas
        expect(fmtDuration((3 * 24 + 5) * 60 * 60 * 1000)).toBe("3d 5h");
    });
});
