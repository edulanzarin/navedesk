/**
 * Testes unitários para `nextTicketId` com mock da sequência Postgres.
 *
 * Cobertura:
 * - Formato `NVD-{n}` produzido a partir de inteiros sequenciais devolvidos
 *   pela sequência (R9.1).
 * - Validação do prefixo `^[A-Z]{2,4}$` via `InvalidTicketPrefixError` (R9.1).
 * - Tolerância às três formas em que o driver `pg` pode devolver `bigint`:
 *   `string`, `number` e `bigint`.
 * - Erros de integração com a sequência (`TicketSequenceError`) quando o
 *   resultado é vazio ou contém valor não-positivo / malformado.
 *
 * O teste isola a função do banco real construindo um stub mínimo do tipo
 * `Database` cuja única responsabilidade é registrar chamadas a `execute`
 * e devolver as linhas controladas pelo teste. Isso preserva a semântica
 * do contrato (tipo Drizzle) sem precisar subir Postgres — a propriedade
 * de monotonicidade real frente a concorrência é validada na tarefa 8.3
 * com Testcontainers.
 *
 * Validates: Requirements 9.1
 */

import { describe, expect, it, vi } from "vitest";

import {
    InvalidTicketPrefixError,
    TicketSequenceError,
    nextTicketId,
} from "@/lib/ticket-id";
import type { Database } from "@/db/client";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Forma do valor que `db.execute` retorna quando a query é
 * `SELECT nextval('ticket_seq') AS nextval`. Drizzle expõe `rows` como o
 * payload tipado pelo generic da chamada.
 */
type NextvalRow = { nextval: string | number | bigint };

/**
 * Cria um stub mínimo de `Database` cujo método `execute` consome valores
 * pré-programados. Cada chamada retorna o próximo `rows` da fila (FIFO),
 * espelhando o comportamento esperado de chamadas sequenciais a `nextval`.
 *
 * O cast final é restrito a esta camada de teste; o consumidor (`nextTicketId`)
 * só usa `db.execute` e desconhece os demais membros da interface Drizzle.
 */
function makeDbStub(rowsQueue: ReadonlyArray<readonly NextvalRow[]>): {
    db: Database;
    execute: ReturnType<typeof vi.fn>;
} {
    const queue = [...rowsQueue];
    const execute = vi.fn(async () => {
        const rows = queue.shift();
        if (!rows) {
            throw new Error(
                "DB stub esgotado: o teste pediu mais chamadas a db.execute do que foi configurado.",
            );
        }
        return { rows };
    });
    const db = { execute } as unknown as Database;
    return { db, execute };
}

// ---------------------------------------------------------------------------
// Formato e sequencialidade — R9.1
// ---------------------------------------------------------------------------

describe("nextTicketId — formato NVD-{n} e sequencialidade", () => {
    it("formata o resultado como `${prefix}-${n}` com inteiros sequenciais", async () => {
        const { db } = makeDbStub([
            [{ nextval: "1042" }],
            [{ nextval: "1043" }],
            [{ nextval: "1044" }],
        ]);

        await expect(nextTicketId("NVD", db)).resolves.toBe("NVD-1042");
        await expect(nextTicketId("NVD", db)).resolves.toBe("NVD-1043");
        await expect(nextTicketId("NVD", db)).resolves.toBe("NVD-1044");
    });

    it("respeita o prefixo informado (casos válidos do regex)", async () => {
        const { db } = makeDbStub([
            [{ nextval: "1" }],
            [{ nextval: "2" }],
            [{ nextval: "3" }],
        ]);

        await expect(nextTicketId("NV", db)).resolves.toBe("NV-1");
        await expect(nextTicketId("NVD", db)).resolves.toBe("NVD-2");
        await expect(nextTicketId("NVDX", db)).resolves.toBe("NVDX-3");
    });

    it("invoca db.execute exatamente uma vez por chamada de nextTicketId", async () => {
        const { db, execute } = makeDbStub([
            [{ nextval: "10" }],
            [{ nextval: "11" }],
        ]);

        await nextTicketId("NVD", db);
        await nextTicketId("NVD", db);

        expect(execute).toHaveBeenCalledTimes(2);
    });
});

// ---------------------------------------------------------------------------
// Tolerância a tipos do driver — string | number | bigint
// ---------------------------------------------------------------------------

describe("nextTicketId — formas aceitas pelo driver", () => {
    it("aceita nextval como string (forma default do driver pg para bigint)", async () => {
        const { db } = makeDbStub([[{ nextval: "1042" }]]);
        await expect(nextTicketId("NVD", db)).resolves.toBe("NVD-1042");
    });

    it("aceita nextval como number quando o parser está configurado para number", async () => {
        const { db } = makeDbStub([[{ nextval: 1042 }]]);
        await expect(nextTicketId("NVD", db)).resolves.toBe("NVD-1042");
    });

    it("aceita nextval como bigint quando o parser está configurado para bigint", async () => {
        const { db } = makeDbStub([[{ nextval: 1042n }]]);
        await expect(nextTicketId("NVD", db)).resolves.toBe("NVD-1042");
    });
});

// ---------------------------------------------------------------------------
// Validação de prefixo — InvalidTicketPrefixError
// ---------------------------------------------------------------------------

describe("nextTicketId — validação do prefixo", () => {
    /**
     * Stub que falha o teste se for invocado: a validação do prefixo deve
     * ocorrer ANTES de qualquer ida ao banco para evitar consumir valores
     * da sequência indevidamente.
     */
    function makeUnusedDb(): Database {
        return {
            execute: vi.fn(() => {
                throw new Error(
                    "db.execute não deveria ter sido chamado — validação de prefixo precede a query.",
                );
            }),
        } as unknown as Database;
    }

    it.each<[string, string]>([
        ["nvd", "letras minúsculas"],
        ["A", "uma única letra (abaixo do mínimo)"],
        ["ABCDE", "cinco letras (acima do máximo)"],
        ["NVD-", "caractere especial"],
        ["NV1", "contém dígito"],
        ["", "string vazia"],
        ["NV ", "contém espaço"],
        ["NVÁ", "contém acento"],
    ])("rejeita prefixo %j (%s) com InvalidTicketPrefixError", async (prefix) => {
        const db = makeUnusedDb();
        await expect(nextTicketId(prefix, db)).rejects.toBeInstanceOf(
            InvalidTicketPrefixError,
        );
    });

    it("a InvalidTicketPrefixError carrega o prefixo recebido", async () => {
        const db = makeUnusedDb();
        try {
            await nextTicketId("nvd", db);
            expect.unreachable("nextTicketId deveria ter lançado");
        } catch (err) {
            expect(err).toBeInstanceOf(InvalidTicketPrefixError);
            expect((err as InvalidTicketPrefixError).prefix).toBe("nvd");
        }
    });

    it("não consulta o banco quando o prefixo é inválido", async () => {
        const execute = vi.fn();
        const db = { execute } as unknown as Database;
        await expect(nextTicketId("X", db)).rejects.toBeInstanceOf(
            InvalidTicketPrefixError,
        );
        expect(execute).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// Erros de sequência — TicketSequenceError
// ---------------------------------------------------------------------------

describe("nextTicketId — erros de sequência", () => {
    it("lança TicketSequenceError quando result.rows está vazio", async () => {
        const { db } = makeDbStub([[]]);
        await expect(nextTicketId("NVD", db)).rejects.toBeInstanceOf(
            TicketSequenceError,
        );
    });

    /**
     * Casos não-bigint cobertos via `it.each`. Bigints ficam fora porque o
     * gerador de nomes do Vitest serializa o argumento com `JSON.stringify`,
     * que não suporta bigint — bigints são testados em blocos separados.
     */
    it.each<[string | number, string]>([
        ["0", "string zero"],
        ["-1", "string negativa"],
        ["12abc", "string com sufixo não-numérico"],
        ["abc", "string totalmente não-numérica"],
        ["1.5", "string com ponto decimal"],
        ["007", "string com zero à esquerda (não casa /^[1-9][0-9]*$/)"],
        [0, "number zero"],
        [-1, "number negativo"],
        [1.5, "number não-inteiro"],
        [Number.NaN, "NaN"],
        [Number.POSITIVE_INFINITY, "infinito positivo"],
        [Number.NEGATIVE_INFINITY, "infinito negativo"],
    ])(
        "lança TicketSequenceError quando nextval = %j (%s)",
        async (badValue) => {
            const { db } = makeDbStub([[{ nextval: badValue }]]);
            await expect(nextTicketId("NVD", db)).rejects.toBeInstanceOf(
                TicketSequenceError,
            );
        },
    );

    it("lança TicketSequenceError quando nextval é bigint zero", async () => {
        const { db } = makeDbStub([[{ nextval: 0n }]]);
        await expect(nextTicketId("NVD", db)).rejects.toBeInstanceOf(
            TicketSequenceError,
        );
    });

    it("lança TicketSequenceError quando nextval é bigint negativo", async () => {
        const { db } = makeDbStub([[{ nextval: -1n }]]);
        await expect(nextTicketId("NVD", db)).rejects.toBeInstanceOf(
            TicketSequenceError,
        );
    });

    it("aceita o menor inteiro positivo válido (1)", async () => {
        const { db } = makeDbStub([[{ nextval: "1" }]]);
        await expect(nextTicketId("NVD", db)).resolves.toBe("NVD-1");
    });

    it("aceita inteiros grandes representados como bigint sem perda de precisão", async () => {
        // Valor acima de Number.MAX_SAFE_INTEGER. Como bigint, `toString()`
        // preserva todos os dígitos — relevante para sequências longevas.
        const big = 9_007_199_254_740_993n;
        const { db } = makeDbStub([[{ nextval: big }]]);
        await expect(nextTicketId("NVD", db)).resolves.toBe(
            `NVD-${big.toString()}`,
        );
    });
});
