/**
 * Unit tests for `lib/mentions`.
 *
 * Cobre:
 * - Extração de tokens `@xxx` e `@xxx.yyy`.
 * - Resolução contra usuários ativos por primeiro nome e por
 *   `primeiro.sobrenome`.
 * - Tolerância a acentos via normalização NFD.
 * - Ambiguidade: dois usuários com o mesmo primeiro nome não
 *   resolvem (token vira `null` em `byToken`, `userIds` não inclui).
 * - Texto sem menções devolve listas vazias.
 */

import { describe, it, expect } from "vitest";

import {
    extractMentionTokens,
    resolveMentions,
    type MentionableUser,
} from "@/lib/mentions";

const USERS: readonly MentionableUser[] = [
    { id: "u-joao-silva", name: "João Silva" },
    { id: "u-maria-souza", name: "Maria Souza" },
    { id: "u-joao-pereira", name: "João Pereira" },
    { id: "u-ana", name: "Ana" },
];

describe("extractMentionTokens", () => {
    it("captures simple @name tokens", () => {
        const tokens = extractMentionTokens("oi @joao, @ana, ok");
        expect(tokens).toEqual(["joao", "ana"]);
    });

    it("captures @first.last form", () => {
        const tokens = extractMentionTokens("ping @joao.silva");
        expect(tokens).toEqual(["joao.silva"]);
    });

    it("returns empty for text without mentions", () => {
        expect(extractMentionTokens("plain text, no @")).toEqual([]);
    });

    it("preserves the order tokens appear in the body", () => {
        const tokens = extractMentionTokens("@b então @a depois @c");
        expect(tokens).toEqual(["b", "a", "c"]);
    });
});

describe("resolveMentions", () => {
    it("resolves first name when unambiguous", () => {
        const r = resolveMentions("@maria por favor", USERS);
        expect(r.userIds).toEqual(["u-maria-souza"]);
        expect(r.byToken.get("maria")).toBe("u-maria-souza");
    });

    it("resolves first.last form for ambiguous first names", () => {
        const r = resolveMentions("@joao.silva confere", USERS);
        expect(r.userIds).toEqual(["u-joao-silva"]);
        expect(r.byToken.get("joao.silva")).toBe("u-joao-silva");
    });

    it("returns null for ambiguous first-name only mentions", () => {
        const r = resolveMentions("@joao", USERS);
        expect(r.userIds).toEqual([]);
        expect(r.byToken.get("joao")).toBeNull();
    });

    it("returns null for unknown tokens", () => {
        const r = resolveMentions("@desconhecido aí?", USERS);
        expect(r.userIds).toEqual([]);
        expect(r.byToken.get("desconhecido")).toBeNull();
    });

    it("normalizes accents (joão → joao)", () => {
        // O usuário escreveu @joão (com til), mas a base bate como `joao`.
        const r = resolveMentions("@joão.silva olha aqui", USERS);
        expect(r.userIds).toEqual(["u-joao-silva"]);
    });

    it("deduplicates the same user mentioned multiple times", () => {
        const r = resolveMentions("@maria, @maria, @maria", USERS);
        expect(r.userIds).toEqual(["u-maria-souza"]);
    });

    it("returns empty when text has no mentions", () => {
        const r = resolveMentions("nada por aqui", USERS);
        expect(r.userIds).toEqual([]);
        expect(r.byToken.size).toBe(0);
    });

    it("returns empty when user list is empty", () => {
        const r = resolveMentions("@maria", []);
        expect(r.userIds).toEqual([]);
        expect(r.byToken.size).toBe(0);
    });

    it("resolves single-word names too", () => {
        const r = resolveMentions("@ana confere isso", USERS);
        expect(r.userIds).toEqual(["u-ana"]);
    });
});
