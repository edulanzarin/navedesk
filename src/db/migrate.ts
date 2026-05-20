/**
 * Idempotent database migration runner.
 *
 * Validates: R17.3, R17.4
 *
 * Phase 1 — Drizzle migrations
 *   Runs `drizzle-orm/node-postgres/migrator::migrate` against
 *   `src/db/migrations`. Drizzle tracks applied migrations in its own
 *   `__drizzle_migrations` table, so re-running is a no-op (R17.4).
 *
 * Phase 2 — Manual SQL files
 *   Some database objects (sequences, custom indexes, materialised views)
 *   are not derivable from the Drizzle schema and live in `src/db/sql/*.sql`
 *   instead. Each file is executed inside a transaction and recorded in
 *   `_manual_migrations(filename, applied_at)`. Files already present in
 *   that table are skipped, making this phase idempotent as well (R17.4).
 *
 * Failure mode
 *   The runner probes the connection before doing any work and prints a
 *   concise error before exiting non-zero on connection failures, missing
 *   `DATABASE_URL`, or any SQL error. Manual SQL files are wrapped in
 *   transactions so a partial failure does not leave the tracking table
 *   inconsistent with the database state.
 *
 * Programmatic API
 *   `runMigrations(pool, options?)` exposes the core logic so it can be
 *   driven from tests (e.g. Testcontainers, task 3.6) or other tooling
 *   without spawning a child process. The CLI block at the bottom is the
 *   thin wrapper used by `pnpm db:migrate`.
 */

import "./_load-env";

import path from "node:path";
import { fileURLToPath } from "node:url";
import { readdir, readFile } from "node:fs/promises";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool, type PoolClient } from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_DRIZZLE_FOLDER = path.join(PROJECT_ROOT, "src", "db", "migrations");
const DEFAULT_MANUAL_SQL_FOLDER = path.join(PROJECT_ROOT, "src", "db", "sql");

const LOG_PREFIX = "[db:migrate]";

export interface RunMigrationsOptions {
    /** Folder containing Drizzle-generated migrations. Defaults to `src/db/migrations`. */
    drizzleFolder?: string;
    /** Folder containing manual `*.sql` files. Defaults to `src/db/sql`. */
    manualSqlFolder?: string;
    /** Optional logger; defaults to `console.log` with the `[db:migrate]` prefix. */
    log?: (message: string) => void;
}

export interface RunMigrationsResult {
    /** Number of manual SQL files applied during this invocation (0 on idempotent re-runs). */
    manualApplied: number;
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
        // pg client errors
        code === "57P03" || // cannot_connect_now
        code === "3D000" // invalid_catalog_name (database does not exist)
    );
}

async function ensureTrackingTable(pool: Pool): Promise<void> {
    await pool.query(
        `CREATE TABLE IF NOT EXISTS _manual_migrations (
            filename   text PRIMARY KEY,
            applied_at timestamptz NOT NULL DEFAULT now()
        )`,
    );
}

async function listManualSqlFiles(folder: string): Promise<string[]> {
    let entries;
    try {
        entries = await readdir(folder, { withFileTypes: true });
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
            return [];
        }
        throw err;
    }

    return entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
        .map((entry) => entry.name)
        .sort((a, b) => a.localeCompare(b));
}

async function applyManualMigrations(
    pool: Pool,
    folder: string,
    log: (message: string) => void,
): Promise<number> {
    const files = await listManualSqlFiles(folder);
    if (files.length === 0) {
        const rel = path.relative(PROJECT_ROOT, folder) || folder;
        log(`no manual SQL files found in ${rel}`);
        return 0;
    }

    const { rows } = await pool.query<{ filename: string }>(
        "SELECT filename FROM _manual_migrations",
    );
    const applied = new Set(rows.map((row) => row.filename));

    let appliedCount = 0;
    for (const filename of files) {
        if (applied.has(filename)) continue;

        const sqlPath = path.join(folder, filename);
        const sql = await readFile(sqlPath, "utf8");

        const client: PoolClient = await pool.connect();
        try {
            await client.query("BEGIN");
            await client.query(sql);
            await client.query(
                "INSERT INTO _manual_migrations (filename) VALUES ($1)",
                [filename],
            );
            await client.query("COMMIT");
            log(`applied manual migration: ${filename}`);
            appliedCount += 1;
        } catch (err) {
            try {
                await client.query("ROLLBACK");
            } catch {
                // ignore rollback errors; surface the original failure below
            }
            throw new Error(
                `Failed applying manual migration ${filename}: ${errorMessage(err)}`,
                { cause: err instanceof Error ? err : undefined },
            );
        } finally {
            client.release();
        }
    }

    if (appliedCount === 0) {
        log("manual SQL migrations already up to date");
    }

    return appliedCount;
}

/**
 * Run all migrations against the supplied pool: first the Drizzle-generated
 * ones, then the manual SQL files. Idempotent: re-running on an up-to-date
 * database is a no-op (validates R17.4).
 *
 * The pool's lifecycle is the caller's responsibility — this function does
 * not call `pool.end()` so it can be reused across test cases.
 */
export async function runMigrations(
    pool: Pool,
    options: RunMigrationsOptions = {},
): Promise<RunMigrationsResult> {
    const drizzleFolder = options.drizzleFolder ?? DEFAULT_DRIZZLE_FOLDER;
    const manualSqlFolder = options.manualSqlFolder ?? DEFAULT_MANUAL_SQL_FOLDER;
    const log = options.log ?? defaultLog;

    const drizzleRel = path.relative(PROJECT_ROOT, drizzleFolder) || drizzleFolder;
    const manualRel = path.relative(PROJECT_ROOT, manualSqlFolder) || manualSqlFolder;

    log(`applying Drizzle migrations from ${drizzleRel}`);
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder: drizzleFolder });
    log("Drizzle migrations up to date");

    log(`scanning manual SQL files in ${manualRel}`);
    await ensureTrackingTable(pool);
    const manualApplied = await applyManualMigrations(pool, manualSqlFolder, log);

    log(`done (manual files applied this run: ${manualApplied})`);
    return { manualApplied };
}

// ---------------------------------------------------------------------------
// CLI entry point: only executes when this module is invoked directly via
// `tsx src/db/migrate.ts` (or `node …`). Importing the module elsewhere —
// e.g. from the integration test in `tests/integration/db/migrate-seed.test.ts`
// — does not trigger the CLI.
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
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
        console.error(
            `${LOG_PREFIX} DATABASE_URL is not set. ` +
            "Configure it in your .env file (see .env.example) before running migrations.",
        );
        process.exit(1);
    }

    const pool = new Pool({
        connectionString: databaseUrl,
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

        await runMigrations(pool);
    } finally {
        await pool.end().catch(() => {
            /* swallow shutdown errors */
        });
    }
}

if (isInvokedAsCli()) {
    runCli().catch((err) => {
        console.error(`${LOG_PREFIX} migration failed: ${errorMessage(err)}`);
        if (err instanceof Error && err.stack) {
            console.error(err.stack);
        }
        process.exit(1);
    });
}
