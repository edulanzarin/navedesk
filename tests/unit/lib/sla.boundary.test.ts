/**
 * Testes unitários de fronteira para `computeSlaInfo`.
 *
 * Cobre os limiares de classificação do nível de SLA (`ok`, `warn`, `crit`,
 * `breached`) e o clamping do percentual decorrido (`pctElapsed`) em [0, 100].
 *
 * Os limiares definidos pelo design são (com `totalMs = hours * 3_600_000`):
 * - `remainingMs > totalMs * 0.25`            → "ok"      (R6.4)
 * - `totalMs * 0.10 < remainingMs ≤ 25%`      → "warn"    (R6.5)
 * - `0 < remainingMs ≤ totalMs * 0.10`        → "crit"    (R6.6)
 * - `remainingMs ≤ 0`                         → "breached"
 *
 * Para os testes usamos `hours = 10`, que produz `totalMs = 36_000_000 ms`
 * (10 horas em milissegundos). Os percentuais ficam, então, em valores inteiros:
 * - 25% → 9_000_000 ms
 * - 10% → 3_600_000 ms
 *
 * Validates: Requirements R6.4, R6.5, R6.6
 */

import { describe, expect, it } from "vitest";

import { computeSlaInfo } from "@/lib/sla";
import type { Priority, SlaPolicy } from "@/types/domain";

const HOURS = 10;
const TOTAL_MS = HOURS * 3_600_000; // 36_000_000
const PRIORITY: Priority = "media";
const POLICIES: SlaPolicy[] = [{ priority: PRIORITY, hours: HOURS }];

/**
 * Helper que constrói `(deadline, now)` tais que
 * `deadline.getTime() - now.getTime() === remainingMs`. Usa um timestamp base
 * fixo para manter o teste determinístico.
 */
function makeInfo(remainingMs: number) {
    const deadline = new Date("2025-01-01T00:00:00.000Z");
    const now = new Date(deadline.getTime() - remainingMs);
    return computeSlaInfo(deadline, PRIORITY, POLICIES, now);
}

describe("computeSlaInfo — limiar 'ok' (R6.4)", () => {
    it("classifica como 'ok' quando remainingMs > 25% (e.g., 26%)", () => {
        const remainingMs = TOTAL_MS * 0.26; // 9_360_000
        const info = makeInfo(remainingMs);

        expect(info.level).toBe("ok");
        expect(info.remainingMs).toBe(remainingMs);
    });

    it("classifica como 'ok' em remainingMs ligeiramente acima de 25%", () => {
        // 1ms acima de 25% — verifica a borda exclusiva do lado 'ok'.
        const remainingMs = TOTAL_MS * 0.25 + 1;
        const info = makeInfo(remainingMs);

        expect(info.level).toBe("ok");
    });
});

describe("computeSlaInfo — limiar 'warn' (R6.5)", () => {
    it("classifica como 'warn' exatamente em 25% (limiar inclusivo)", () => {
        const remainingMs = TOTAL_MS * 0.25; // 9_000_000
        const info = makeInfo(remainingMs);

        expect(info.level).toBe("warn");
        expect(info.pctElapsed).toBe(75);
    });

    it("classifica como 'warn' em 11% (acima de 10%, dentro de 25%)", () => {
        const remainingMs = TOTAL_MS * 0.11; // 3_960_000
        const info = makeInfo(remainingMs);

        expect(info.level).toBe("warn");
    });

    it("classifica como 'warn' em remainingMs ligeiramente acima de 10%", () => {
        // 1ms acima de 10% — verifica a borda exclusiva do lado 'warn'.
        const remainingMs = TOTAL_MS * 0.1 + 1;
        const info = makeInfo(remainingMs);

        expect(info.level).toBe("warn");
    });
});

describe("computeSlaInfo — limiar 'crit' (R6.6)", () => {
    it("classifica como 'crit' exatamente em 10% (limiar inclusivo)", () => {
        const remainingMs = TOTAL_MS * 0.1; // 3_600_000
        const info = makeInfo(remainingMs);

        expect(info.level).toBe("crit");
        expect(info.pctElapsed).toBe(90);
    });

    it("classifica como 'crit' em 0,001% (próximo de zero, ainda > 0)", () => {
        const remainingMs = Math.round(TOTAL_MS * 0.00001); // 360 ms
        // sanity check para a fixture: precisa ser > 0 e ≤ 10% de TOTAL_MS.
        expect(remainingMs).toBeGreaterThan(0);
        expect(remainingMs).toBeLessThanOrEqual(TOTAL_MS * 0.1);

        const info = makeInfo(remainingMs);

        expect(info.level).toBe("crit");
    });

    it("classifica como 'crit' em remainingMs = 1 ms (mínimo positivo)", () => {
        const info = makeInfo(1);

        expect(info.level).toBe("crit");
    });
});

describe("computeSlaInfo — limiar 'breached'", () => {
    it("classifica como 'breached' exatamente em remainingMs === 0", () => {
        const info = makeInfo(0);

        expect(info.level).toBe("breached");
        expect(info.remainingMs).toBe(0);
        expect(info.pctElapsed).toBe(100);
    });

    it("classifica como 'breached' quando remainingMs < 0 (vencido)", () => {
        const info = makeInfo(-1);

        expect(info.level).toBe("breached");
        expect(info.remainingMs).toBe(-1);
    });

    it("mantém 'breached' para atrasos significativos (precedência sobre crit/warn)", () => {
        const info = makeInfo(-TOTAL_MS); // um SLA inteiro vencido
        expect(info.level).toBe("breached");
    });
});

describe("computeSlaInfo — clamping de pctElapsed", () => {
    it("fixa pctElapsed em 100 quando o ticket está muito além do deadline", () => {
        // remainingMs = -totalMs ⇒ 100 - (-100) = 200 → clamp para 100.
        const info = makeInfo(-TOTAL_MS);

        expect(info.pctElapsed).toBe(100);
    });

    it("fixa pctElapsed em 100 mesmo com atraso extremo (vários SLAs vencidos)", () => {
        const info = makeInfo(-TOTAL_MS * 10);

        expect(info.pctElapsed).toBe(100);
    });

    it("fixa pctElapsed em 0 quando 'now' está antes da criação (remainingMs > totalMs)", () => {
        // remainingMs = 2 * totalMs ⇒ 100 - 200 = -100 → clamp para 0.
        const info = makeInfo(TOTAL_MS * 2);

        expect(info.pctElapsed).toBe(0);
    });

    it("fixa pctElapsed em 0 mesmo com 'now' muito antes da criação", () => {
        const info = makeInfo(TOTAL_MS * 100);

        expect(info.pctElapsed).toBe(0);
    });

    it("retorna pctElapsed exatamente em 0 quando remainingMs === totalMs (sem decorrido)", () => {
        const info = makeInfo(TOTAL_MS);

        expect(info.pctElapsed).toBe(0);
    });
});
