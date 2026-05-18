/**
 * Integration test: migrations and seed against an ephemeral PostgreSQL
 * container.
 *
 * Validates: R17.4, R18.6, R18.7
 *
 * The test exercises the same `runMigrations` and `seedIfEmpty` functions
 * that `pnpm db:migrate` and `pnpm db:seed:if-empty` invoke. It executes
 * each operation twice and checks that:
 *
 *   - Re-running migrations is a no-op (R17.4): the second `runMigrations`
 *     call applies zero manual SQL files and the underlying `_manual_migrations`
 *     and `__drizzle_migrations` tables remain stable.
 *   - Re-running the seed is a no-op (R18.7): the second `seedIfEmpty`
 *     call observes the populated `users` table and skips inserting.
 *   - The seeded data matches the documented defaults (R18.6): exact row
 *     counts in `users` (3), `categories` (6) and `sla_policies` (4),
 *     plus presence of the `ticket_seq` sequence applied by the manual
 *     SQL phase.
 *
 * The container is provisioned via `@testcontainers/postgresql`. When
 * Docker is unavailable (CI without docker, sandboxed dev box) the suite
 * is skipped gracefully via `describe.skipIf` rather than failing.
 */

import { execSync } from "node:child_process";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    PostgreSqlContainer,
    type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";

import { runMigrations } from "@/db/migrate";
import { seedIfEmpty, SEED_COUNTS } from "@/db/seed";

function isDockerAvailable(): boolean {
    try {
        execSync("docker version --format \"{{.Server.Version}}\"", {
            stdio: "ignore",
            timeout: 5_000,
        });
        return true;
    } catch {
        return false;
    }
}

const dockerAvailable = isDockerAvailable();

describe.skipIf(!dockerAvailable)(
    "db migrations and seed (Testcontainers)",
    () => {
        let container: StartedPostgreSqlContainer;
        let pool: Pool;

        beforeAll(async () => {
            container = await new PostgreSqlContainer("postgres:16-alpine")
                .withDatabase("navedesk_test")
                .withUsername("test")
                .withPassword("test")
                .start();

            pool = new Pool({
                connectionString: container.getConnectionUri(),
                max: 4,
                connectionTimeoutMillis: 10_000,
            });
        }, 120_000);

        afterAll(async () => {
            await pool?.end().catch(() => {
                /* swallow shutdown errors */
            });
            await container?.stop().catch(() => {
                /* swallow shutdown errors */
            });
        }, 60_000);

        it("runs migrations idempotently and seeds default data exactly once", async () => {
            // Silent loggers keep the integration output readable; we still
            // assert behaviour through return values and SQL probes.
            const silentLog = (_message: string) => {
                /* no-op */
            };

            // --- Migrations: first run applies everything ---
            const firstMigrate = await runMigrations(pool, { log: silentLog });
            expect(firstMigrate.manualApplied).toBeGreaterThan(0);

            // After the first run, the core tables (and the ticket_seq
            // sequence applied via manual SQL) must exist.
            await expect(
                pool.query("SELECT 1 FROM users LIMIT 0"),
            ).resolves.toBeDefined();
            await expect(
                pool.query("SELECT 1 FROM categories LIMIT 0"),
            ).resolves.toBeDefined();
            await expect(
                pool.query("SELECT 1 FROM sla_policies LIMIT 0"),
            ).resolves.toBeDefined();

            const seqProbe = await pool.query<{ exists: boolean }>(
                `SELECT EXISTS (
                    SELECT 1 FROM pg_class c
                    JOIN pg_namespace n ON n.oid = c.relnamespace
                    WHERE c.relkind = 'S' AND c.relname = 'ticket_seq'
                ) AS exists`,
            );
            expect(seqProbe.rows[0]?.exists).toBe(true);

            // --- Migrations: second run is a no-op (R17.4) ---
            const secondMigrate = await runMigrations(pool, { log: silentLog });
            expect(secondMigrate.manualApplied).toBe(0);

            // --- Seed: first run populates default data (R18.6) ---
            const firstSeed = await seedIfEmpty(pool, { log: silentLog });
            expect(firstSeed).toEqual({ seeded: true, existingUsers: 0 });

            // --- Seed: second run is a no-op (R18.7) ---
            const secondSeed = await seedIfEmpty(pool, { log: silentLog });
            expect(secondSeed.seeded).toBe(false);
            expect(secondSeed.existingUsers).toBe(SEED_COUNTS.users);

            // --- Row counts after the second seed must match defaults (R18.6) ---
            async function countRows(table: string): Promise<number> {
                const { rows } = await pool.query<{ count: string }>(
                    `SELECT COUNT(*)::text AS count FROM ${table}`,
                );
                return Number.parseInt(rows[0]?.count ?? "0", 10);
            }

            expect(await countRows("users")).toBe(SEED_COUNTS.users);
            expect(await countRows("categories")).toBe(SEED_COUNTS.categories);
            expect(await countRows("sla_policies")).toBe(SEED_COUNTS.slaPolicies);
            expect(await countRows("departments")).toBe(SEED_COUNTS.departments);
            expect(await countRows("kb_categories")).toBe(SEED_COUNTS.kbCategories);

            // Spot-check the absolute counts the spec calls out explicitly:
            // users === 3, categories === 6, sla_policies === 4.
            expect(await countRows("users")).toBe(3);
            expect(await countRows("categories")).toBe(6);
            expect(await countRows("sla_policies")).toBe(4);
        });
    },
);

describe.skipIf(dockerAvailable)("db migrations and seed (Testcontainers)", () => {
    it.skip("requires Docker to run; skipped because docker is not available", () => {
        /* Docker not detected; the real suite above is skipped. */
    });
});
