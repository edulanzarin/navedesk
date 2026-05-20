/**
 * Carregador minimalista de `.env` para scripts CLI (`pnpm db:migrate`,
 * `pnpm db:seed:if-empty`, `pnpm tsx scripts/...`).
 *
 * Por que não usar `dotenv`? Adicionar uma dependência só para isto é
 * desproporcional. O Next.js já carrega `.env` automaticamente quando
 * roda via `next dev`/`next start`; este utilitário cobre apenas os
 * scripts standalone que rodam fora do servidor Next.
 *
 * Comportamento:
 * - Procura `.env`, `.env.local`, `.env.development.local` na raiz do
 *   projeto (mesma ordem do Next.js — mais específico ganha).
 * - Apenas variáveis que **não estão** definidas no `process.env` são
 *   sobrescritas — assim, valores passados pelo Docker (Compose) ou
 *   pela CI continuam tendo precedência.
 * - Aceita `KEY=value`, `KEY="value with spaces"`, `KEY='value'`,
 *   linhas em branco e comentários iniciados por `#`. Qualquer outra
 *   coisa é ignorada silenciosamente.
 *
 * Uso:
 *   import "./_load-env"; // primeiro import do arquivo CLI
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = path.resolve(path.dirname(__filename), "..", "..");

const FILES = [
    ".env.development.local",
    ".env.local",
    ".env",
];

function parseLine(
    line: string,
): { key: string; value: string } | undefined {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) return undefined;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) return undefined;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    // Remove trailing inline comment se valor não está entre aspas.
    if (
        !(value.startsWith('"') && value.endsWith('"')) &&
        !(value.startsWith("'") && value.endsWith("'"))
    ) {
        const hash = value.indexOf(" #");
        if (hash >= 0) value = value.slice(0, hash).trim();
    }
    // Tira aspas circundantes.
    if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
    ) {
        value = value.slice(1, -1);
    }
    return { key, value };
}

function loadFile(absPath: string): void {
    if (!existsSync(absPath)) return;
    const content = readFileSync(absPath, "utf8");
    for (const rawLine of content.split(/\r?\n/)) {
        const parsed = parseLine(rawLine);
        if (!parsed) continue;
        if (process.env[parsed.key] === undefined) {
            process.env[parsed.key] = parsed.value;
        }
    }
}

for (const name of FILES) {
    loadFile(path.join(PROJECT_ROOT, name));
}
