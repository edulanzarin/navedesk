/**
 * Idempotent database seed.
 *
 * Validates: R6.1, R14.2, R18.6, R18.7
 *
 * The seed is the third step of `Bootstrap_Compose`, executed after the
 * Drizzle migrations (R18.1). It populates *only* the reference data and a
 * minimal set of demo users on a brand-new database, leaving everything
 * untouched on subsequent runs.
 *
 * Idempotency contract (R18.7)
 *   The script first counts rows in `users` and aborts immediately when
 *   the table is non-empty. Because every demo user is also inserted in
 *   the same transaction as the reference data, a populated `users`
 *   table is a reliable proxy for "this database has already been
 *   seeded". On an empty DB it inserts everything inside a single
 *   transaction so partial failures roll back cleanly.
 *
 * Default data (R6.1, R14.2, R18.6)
 *   - Departments: Fiscal, Contabilidade, TI
 *   - Categories: hardware, software, sistema, rede, acesso, email
 *   - SLA policies: baixa=48h, media=24h, alta=8h, critica=2h
 *   - KB categories: acesso, sistemas, geral
 *   - Users: admin, técnico e solicitante (senha "admin123",
 *     bcrypt cost 12, R14.2)
 *
 * Programmatic API
 *   `seedIfEmpty(pool, options?)` exposes the core logic so it can be
 *   driven from tests (e.g. Testcontainers, task 3.6) or other tooling
 *   without spawning a child process. The CLI block at the bottom is the
 *   thin wrapper used by `pnpm db:seed:if-empty`.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

import bcrypt from "bcrypt";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import {
    categories,
    departments,
    kbCategories,
    slaPolicies,
    users,
} from "./schema";
import type { Priority } from "@/types/domain";

const __filename = fileURLToPath(import.meta.url);

const LOG_PREFIX = "[db:seed]";
const BCRYPT_COST = 12;
const DEMO_PASSWORD = "Edz#7284@";

const DEPARTMENT_NAMES = ["Fiscal", "Contabilidade", "TI"] as const;
type DepartmentName = (typeof DEPARTMENT_NAMES)[number];

interface SeedCategory {
    id: string;
    label: string;
    sub: string;
    icon: string;
}

const DEFAULT_CATEGORIES: readonly SeedCategory[] = [
    { id: "hardware", label: "Hardware", sub: "Equipamentos físicos", icon: "monitor" },
    { id: "software", label: "Software", sub: "Aplicativos e licenças", icon: "package" },
    { id: "sistema", label: "Sistema", sub: "Sistemas internos", icon: "cog" },
    { id: "rede", label: "Rede", sub: "Conectividade e internet", icon: "wifi" },
    { id: "acesso", label: "Acesso", sub: "Permissões e credenciais", icon: "key" },
    { id: "email", label: "E-mail", sub: "Caixa postal e listas", icon: "mail" },
] as const;

const DEFAULT_SLA: ReadonlyArray<{ priority: Priority; hours: number }> = [
    { priority: "baixa", hours: 48 },
    { priority: "media", hours: 24 },
    { priority: "alta", hours: 8 },
    { priority: "critica", hours: 2 },
];

interface SeedKbCategory {
    id: string;
    label: string;
    icon: string;
}

const DEFAULT_KB_CATEGORIES: readonly SeedKbCategory[] = [
    { id: "acesso", label: "Acesso", icon: "key" },
    { id: "sistemas", label: "Sistemas", icon: "monitor" },
    { id: "geral", label: "Geral", icon: "info" },
] as const;

interface SeedUser {
    email: string;
    name: string;
    role: "solicitante" | "tecnico" | "admin";
    department: DepartmentName;
}

const DEFAULT_USERS: readonly SeedUser[] = [
    {
        email: "eduardo.lanzarin@navecon.net.br",
        name: "Eduardo Lanzarin",
        role: "admin",
        department: "TI",
    },
] as const;

// Counts of each row group inserted by a successful seed; useful for tests
// asserting idempotency (validates R18.7).
export const SEED_COUNTS = {
    departments: DEPARTMENT_NAMES.length,
    categories: DEFAULT_CATEGORIES.length,
    slaPolicies: DEFAULT_SLA.length,
    kbCategories: DEFAULT_KB_CATEGORIES.length,
    users: DEFAULT_USERS.length,
} as const;

export interface SeedIfEmptyOptions {
    /** Optional logger; defaults to `console.log` with the `[db:seed]` prefix. */
    log?: (message: string) => void;
}

export interface SeedIfEmptyResult {
    /** `true` when this invocation actually inserted seed data; `false` on no-op runs. */
    seeded: boolean;
    /** Row count observed in `users` before (and after, on no-op) the seed attempt. */
    existingUsers: number;
}

function defaultLog(message: string): void {
    console.log(`${LOG_PREFIX} ${message}`);
}

function errorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    return String(err);
}

function isConnectionError(err: unknown): boolean {
    if (!(err instanceof Error)) return false;
    const code = (err as NodeJS.ErrnoException).code;
    return (
        code === "ECONNREFUSED" ||
        code === "ENOTFOUND" ||
        code === "EAI_AGAIN" ||
        code === "ETIMEDOUT" ||
        code === "ECONNRESET" ||
        code === "57P03" ||
        code === "3D000"
    );
}

/**
 * Seed default data only when `users` is empty (R18.7). Idempotent:
 * subsequent invocations against an already-seeded database are no-ops
 * and return `{ seeded: false, existingUsers: <n> }`.
 *
 * The pool's lifecycle is the caller's responsibility — this function does
 * not call `pool.end()` so it can be reused across test cases.
 */
export async function seedIfEmpty(
    pool: Pool,
    options: SeedIfEmptyOptions = {},
): Promise<SeedIfEmptyResult> {
    const log = options.log ?? defaultLog;
    const db = drizzle(pool);

    // R18.7 — bail out if any user already exists. Counting `users`
    // is enough because every seed run inserts demo users atomically
    // with the reference data inside a single transaction.
    const [usersCountRow] = await db
        .select({ count: sql<string>`count(*)` })
        .from(users);
    const existingUsers = Number.parseInt(usersCountRow?.count ?? "0", 10);

    if (existingUsers > 0) {
        log("users table not empty, skipping seed");
        return { seeded: false, existingUsers };
    }

    log("users table is empty, seeding default data");

    // Hash demo password once before the transaction; bcrypt cost 12
    // is the contract for every persisted user (R14.2).
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, BCRYPT_COST);

    await db.transaction(async (tx) => {
        // Departments — R18.6
        const departmentRows = await tx
            .insert(departments)
            .values(DEPARTMENT_NAMES.map((name) => ({ name })))
            .returning({ id: departments.id, name: departments.name });

        const departmentIdByName = new Map<DepartmentName, string>();
        for (const row of departmentRows) {
            departmentIdByName.set(row.name as DepartmentName, row.id);
        }
        for (const name of DEPARTMENT_NAMES) {
            if (!departmentIdByName.has(name)) {
                throw new Error(
                    `seed invariant: department "${name}" was not inserted`,
                );
            }
        }

        // Categories — R18.6
        await tx.insert(categories).values(
            DEFAULT_CATEGORIES.map((c) => ({
                id: c.id,
                label: c.label,
                sub: c.sub,
                icon: c.icon,
            })),
        );

        // SLA policies — R6.1, R18.6
        await tx.insert(slaPolicies).values(
            DEFAULT_SLA.map((p) => ({
                priority: p.priority,
                hours: p.hours,
            })),
        );

        // KB categories — R18.6 (referenced by future KB articles)
        await tx.insert(kbCategories).values(
            DEFAULT_KB_CATEGORIES.map((c) => ({
                id: c.id,
                label: c.label,
                icon: c.icon,
            })),
        );

        // Users — R14.2, R18.6
        await tx.insert(users).values(
            DEFAULT_USERS.map((u) => {
                const departmentId = departmentIdByName.get(u.department);
                if (!departmentId) {
                    throw new Error(
                        `seed invariant: department "${u.department}" missing for user ${u.email}`,
                    );
                }
                return {
                    email: u.email,
                    name: u.name,
                    role: u.role,
                    departmentId,
                    passwordHash,
                };
            }),
        );
    });

    log(
        `seed complete: ${SEED_COUNTS.departments} departments, ${SEED_COUNTS.categories} categories, ` +
        `${SEED_COUNTS.slaPolicies} SLA policies, ${SEED_COUNTS.kbCategories} KB categories, ${SEED_COUNTS.users} users`,
    );

    return { seeded: true, existingUsers: 0 };
}

// ---------------------------------------------------------------------------
// CLI entry point: only executes when this module is invoked directly via
// `tsx src/db/seed.ts`. Importing the module elsewhere — e.g. from the
// integration test in `tests/integration/db/migrate-seed.test.ts` — does
// not trigger the CLI nor open a real database connection.
// ---------------------------------------------------------------------------

function isInvokedAsCli(): boolean {
    const entry = process.argv[1];
    if (!entry) return false;
    try {
        const entryPath = path.resolve(entry);
        return entryPath === __filename;
    } catch {
        return false;
    }
}

async function runCli(): Promise<void> {
    if (!process.env.DATABASE_URL) {
        console.error(
            `${LOG_PREFIX} DATABASE_URL is not set. ` +
            "Configure it in your .env file (see .env.example) before seeding.",
        );
        process.exit(1);
    }

    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        max: 1,
        connectionTimeoutMillis: 10_000,
    });

    pool.on("error", (err) => {
        console.error(`${LOG_PREFIX} unexpected pool error: ${errorMessage(err)}`);
    });

    try {
        try {
            await pool.query("SELECT 1");
        } catch (err) {
            if (isConnectionError(err)) {
                console.error(
                    `${LOG_PREFIX} could not connect to PostgreSQL using DATABASE_URL. ` +
                    "Verify the host, port, credentials, and that the database is reachable.",
                );
                console.error(`${LOG_PREFIX} cause: ${errorMessage(err)}`);
                process.exit(1);
            }
            throw err;
        }

        await seedIfEmpty(pool);
    } finally {
        await pool.end().catch(() => {
            /* swallow shutdown errors */
        });
    }
}

if (isInvokedAsCli()) {
    runCli().catch((err) => {
        console.error(`${LOG_PREFIX} seed failed: ${errorMessage(err)}`);
        if (err instanceof Error && err.stack) {
            console.error(err.stack);
        }
        process.exit(1);
    });
}
