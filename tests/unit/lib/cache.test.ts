/**
 * Testes unitários para o helper de cache TTL em memória.
 *
 * Validates: Requirements R15.3
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTtlCache } from "@/lib/cache";

describe("createTtlCache", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("retorna undefined para chave inexistente", () => {
        const cache = createTtlCache(60_000);
        expect(cache.get("missing")).toBeUndefined();
    });

    it("armazena e recupera valor antes de expirar", () => {
        const cache = createTtlCache(60_000);
        cache.set("k", { hours: 8 });
        expect(cache.get<{ hours: number }>("k")).toEqual({ hours: 8 });
    });

    it("expira após o TTL e remove a entrada", () => {
        const cache = createTtlCache(1_000);
        cache.set("k", "v");

        // Avança 999ms — ainda válido.
        vi.advanceTimersByTime(999);
        expect(cache.get("k")).toBe("v");

        // Avança mais 2ms para passar do limite.
        vi.advanceTimersByTime(2);
        expect(cache.get("k")).toBeUndefined();

        // Segundo get continua retornando undefined (entrada removida).
        expect(cache.get("k")).toBeUndefined();
    });

    it("aceita TTL customizado em set sobrescrevendo o default", () => {
        const cache = createTtlCache(60_000);
        cache.set("k", "v", 500);

        vi.advanceTimersByTime(501);
        expect(cache.get("k")).toBeUndefined();
    });

    it("invalidate remove apenas a chave especificada", () => {
        const cache = createTtlCache(60_000);
        cache.set("a", 1);
        cache.set("b", 2);

        cache.invalidate("a");

        expect(cache.get("a")).toBeUndefined();
        expect(cache.get("b")).toBe(2);
    });

    it("clear remove todas as entradas", () => {
        const cache = createTtlCache(60_000);
        cache.set("a", 1);
        cache.set("b", 2);

        cache.clear();

        expect(cache.get("a")).toBeUndefined();
        expect(cache.get("b")).toBeUndefined();
    });

    it("set sobrescreve valor existente e renova TTL", () => {
        const cache = createTtlCache(1_000);
        cache.set("k", "old");

        vi.advanceTimersByTime(800);
        cache.set("k", "new");

        // Já passamos 800ms do TTL original, mas o set renovou para 1000ms.
        vi.advanceTimersByTime(800);
        expect(cache.get("k")).toBe("new");

        vi.advanceTimersByTime(300);
        expect(cache.get("k")).toBeUndefined();
    });
});
