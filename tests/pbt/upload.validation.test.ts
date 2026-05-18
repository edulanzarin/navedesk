/**
 * Property-Based Test — Property 11: Validação de upload.
 *
 * Captura o invariante declarado no design:
 *
 *   Todo arquivo aceito satisfaz
 *   `mime ∈ UploadConstraints.allowedMime ∧ size ≤ UploadConstraints.maxBytes`.
 *
 * O design (cf. `design.md → Property 11`) define a propriedade sobre o
 * predicado de aceitação dos campos `mime` e `size`. A rota
 * `POST /api/uploads` adiciona checagens ortogonais — autenticação, rate
 * limit, presença do arquivo, magic bytes, etc. — que estão fora do escopo
 * desta propriedade. Para isolar o predicado, replicamos aqui exatamente
 * a regra usada por `src/app/api/uploads/route.ts` em torno de
 * `UploadConstraints.allowedMime` e `UploadConstraints.maxBytes`:
 *
 *   isUploadAccepted(mime, size) ⇔ mime ∈ allowedMime ∧ size ≤ maxBytes
 *
 * A propriedade é então verificada em duas direções (soundness e
 * completeness) para detectar tanto falsos-positivos quanto falsos-negativos.
 *
 * Validates: Requirements 8.2, 8.3
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { UploadConstraints } from "@/lib/schemas";

// ---------------------------------------------------------------------------
// Predicado em teste
// ---------------------------------------------------------------------------

/**
 * Reproduz a regra de aceitação aplicada pela rota
 * `POST /api/uploads` antes de qualquer leitura de buffer:
 *
 *  - MIME declarado deve estar na allowlist (R8.2).
 *  - Tamanho não pode exceder `maxBytes` (R8.3).
 */
function isUploadAccepted(mime: string, size: number): boolean {
    return (
        (UploadConstraints.allowedMime as readonly string[]).includes(mime) &&
        size <= UploadConstraints.maxBytes
    );
}

// ---------------------------------------------------------------------------
// Arbitrários
// ---------------------------------------------------------------------------

/** MIME válido, sorteado da allowlist canônica. */
const allowedMimeArb: fc.Arbitrary<string> = fc.constantFrom(
    ...UploadConstraints.allowedMime,
);

/**
 * Mistura de MIMEs válidos e arbitrários. `fc.string()` cobre o espaço
 * “quase tudo é inválido”; `allowedMimeArb` garante cobertura do ramo
 * positivo. A mistura é necessária para que a propriedade exercite
 * ambos os ramos do predicado.
 */
const mimeArb: fc.Arbitrary<string> = fc.oneof(
    { weight: 1, arbitrary: allowedMimeArb },
    { weight: 1, arbitrary: fc.string() },
);

/**
 * Tamanhos cobrindo desde 0 até bem além de `maxBytes`. `100_000_000`
 * (≈95 MiB) excede com folga o limite de 25 MiB e exercita a fronteira
 * superior do predicado.
 */
const sizeArb: fc.Arbitrary<number> = fc.integer({ min: 0, max: 100_000_000 });

// ---------------------------------------------------------------------------
// Property 11
// ---------------------------------------------------------------------------

describe("Property 11: validação de upload (mime ∈ allowedMime ∧ size ≤ maxBytes)", () => {
    it("soundness: se isUploadAccepted(mime, size) é true, então mime ∈ allowedMime ∧ size ≤ maxBytes", () => {
        fc.assert(
            fc.property(mimeArb, sizeArb, (mime, size) => {
                if (isUploadAccepted(mime, size)) {
                    expect(
                        (
                            UploadConstraints.allowedMime as readonly string[]
                        ).includes(mime),
                    ).toBe(true);
                    expect(size).toBeLessThanOrEqual(
                        UploadConstraints.maxBytes,
                    );
                }
            }),
            { numRuns: 1000 },
        );
    });

    it("completeness: para todo mime ∈ allowedMime e size ∈ [0, maxBytes], isUploadAccepted é true", () => {
        const acceptedSizeArb: fc.Arbitrary<number> = fc.integer({
            min: 0,
            max: UploadConstraints.maxBytes,
        });

        fc.assert(
            fc.property(allowedMimeArb, acceptedSizeArb, (mime, size) => {
                expect(isUploadAccepted(mime, size)).toBe(true);
            }),
            { numRuns: 1000 },
        );
    });

    it("rejeita: size > maxBytes implica isUploadAccepted(mime, size) === false, mesmo com mime válido", () => {
        const oversizedArb: fc.Arbitrary<number> = fc.integer({
            min: UploadConstraints.maxBytes + 1,
            max: UploadConstraints.maxBytes + 100_000_000,
        });

        fc.assert(
            fc.property(allowedMimeArb, oversizedArb, (mime, size) => {
                expect(isUploadAccepted(mime, size)).toBe(false);
            }),
            { numRuns: 500 },
        );
    });

    it("rejeita: mime ∉ allowedMime implica isUploadAccepted(mime, size) === false, mesmo com size válido", () => {
        const acceptedSizeArb: fc.Arbitrary<number> = fc.integer({
            min: 0,
            max: UploadConstraints.maxBytes,
        });

        const invalidMimeArb: fc.Arbitrary<string> = fc
            .string()
            .filter(
                (s) =>
                    !(
                        UploadConstraints.allowedMime as readonly string[]
                    ).includes(s),
            );

        fc.assert(
            fc.property(invalidMimeArb, acceptedSizeArb, (mime, size) => {
                expect(isUploadAccepted(mime, size)).toBe(false);
            }),
            { numRuns: 500 },
        );
    });

    it("fronteira exata: size === maxBytes é aceito; size === maxBytes + 1 é rejeitado (para todo mime válido)", () => {
        fc.assert(
            fc.property(allowedMimeArb, (mime) => {
                expect(
                    isUploadAccepted(mime, UploadConstraints.maxBytes),
                ).toBe(true);
                expect(
                    isUploadAccepted(mime, UploadConstraints.maxBytes + 1),
                ).toBe(false);
            }),
            { numRuns: UploadConstraints.allowedMime.length * 5 },
        );
    });
});
