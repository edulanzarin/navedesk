/**
 * Integration test: authentication via `verifyPassword` and login rate
 * limiting against an ephemeral PostgreSQL container.
 *
 * Validates: R1.2, R1.3, R1.5, R1.9
 *
 * Scenarios exercised
 *   - `verifyPassword` accepts the right password for an active user and
 *     returns a populated `SessionUser` (R1.2).
 *   - `verifyPassword` rejects the wrong password with no detail leak
 *     (R1.2 / R1.3).
 *   - `verifyPassword` rejects an active=false account even when the
 *     password is correct (R1.5).
 *   - `verifyPassword` rejects an unknown email with the same generic
 *     `{ ok: false }` response — no enumeration (R1.3).
 *   - `InMemoryRateLimiter` configured with `LOGIN_RATE_LIMIT` allows the
 *     first 10 attempts in a window and denies the 11th (R1.9).
 *
 * Container lifecycle
 *   The PostgreSQL container is provisioned via `@testcontainers/postgresql`
 *   and torn down in `afterAll`. When Docker is unavailable (e.g. CI
 *   without docker, sandboxed dev box) the suite is skipped gracefully
 *   via `describe.skipIf` instead of failing.
 *
 * Note on imports
 *   `@/services/users.service` transitively imports `@/db/client`, which
 *   throws if `DATABASE_URL` is unset at module load time. We therefore
 *   set `DATABASE_URL` after the container starts and pull `verifyPassword`
 *   in via a dynamic `await import(...)`. The test still uses its own
 *   pool/drizzle instance (passed explicitly into `verifyPassword`); the
 *   shared global `db` is never touched.
 */

import { execSync } from "node:child_process";

import bcrypt from "bcrypt";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    PostgreSqlContainer,
    type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";

import type { Database } from "@/db/client";
import { runMigrations } from "@/db/migrate";
import { departments, users } from "@/db/schema";
import { InMemoryRateLimiter, LOGIN_RATE_LIMIT } from "@/lib/rate-limit";
import type { verifyPassword as VerifyPasswordFn } from "@/services/users.service";

function isDockerAvailable(): boolean {
    try {
        execSync('docker version --format "{{.Server.Version}}"', {
            stdio: "ignore",
            timeout: 5_000,
        });
        return true;
    } catch {
        return false;
    }
}

const dockerAvailable = isDockerAvailable();

describe.skipIf(!dockerAvailable)("auth integration (Testcontainers)", () => {
    let container: StartedPostgreSqlContainer;
    let pool: Pool;
    let db: Database;
    let verifyPassword: typeof VerifyPasswordFn;

    beforeAll(async () => {
        container = await new PostgreSqlContainer("postgres:16-alpine")
            .withDatabase("navedesk_test")
            .withUsername("test")
            .withPassword("test")
            .start();

        const connectionString = container.getConnectionUri();

        // Satisfy the `DATABASE_URL` guard in `@/db/client` so the dynamic
        // import below doesn't throw. The shared `db` instance built from
        // this URL is never used — the test passes its own drizzle handle.
        process.env.DATABASE_URL = connectionString;

        pool = new Pool({
            connectionString,
            max: 4,
            connectionTimeoutMillis: 10_000,
        });
        db = drizzle(pool) as unknown as Database;

        await runMigrations(pool, { log: () => undefined });

        // --- Minimal seed: 1 department + 2 users (active + inactive) ---
        const [department] = await db
            .insert(departments)
            .values({ name: "TI" })
            .returning({ id: departments.id });
        if (!department) {
            throw new Error("seed: failed to insert department");
        }

        const passwordHash = await bcrypt.hash("admin123", 12);

        await db.insert(users).values([
            {
                email: "active@test.com",
                name: "Usuário Ativo",
                role: "solicitante",
                passwordHash,
                departmentId: department.id,
                active: true,
            },
            {
                email: "inactive@test.com",
                name: "Usuário Inativo",
                role: "solicitante",
                passwordHash,
                departmentId: department.id,
                active: false,
            },
        ]);

        // Dynamic import: deferred until `DATABASE_URL` is set so the
        // module-level guard in `@/db/client` accepts the load.
        const mod = await import("@/services/users.service");
        verifyPassword = mod.verifyPassword;
    }, 120_000);

    afterAll(async () => {
        await pool?.end().catch(() => {
            /* swallow shutdown errors */
        });
        await container?.stop().catch(() => {
            /* swallow shutdown errors */
        });
    }, 60_000);

    describe("verifyPassword", () => {
        it("accepts the correct password for an active user (R1.2)", async () => {
            const result = await verifyPassword(
                db,
                "active@test.com",
                "admin123",
            );

            expect(result.ok).toBe(true);
            expect(result.user).toBeDefined();
            expect(result.user).toMatchObject({
                email: "active@test.com",
                name: "Usuário Ativo",
                role: "solicitante",
            });
            // The session payload must never leak the password hash.
            expect(result.user as object).not.toHaveProperty("passwordHash");
        });

        it("rejects an incorrect password with a generic response (R1.2, R1.3)", async () => {
            const result = await verifyPassword(
                db,
                "active@test.com",
                "senha-errada",
            );

            expect(result.ok).toBe(false);
            expect(result.user).toBeUndefined();
        });

        it("rejects login for an inactive account even with the right password (R1.5)", async () => {
            const result = await verifyPassword(
                db,
                "inactive@test.com",
                "admin123",
            );

            expect(result.ok).toBe(false);
            expect(result.user).toBeUndefined();
        });

        it("rejects an unknown email with the same shape as a wrong password (R1.3)", async () => {
            const result = await verifyPassword(
                db,
                "missing@test.com",
                "admin123",
            );

            expect(result.ok).toBe(false);
            expect(result.user).toBeUndefined();
        });
    });

    describe("login rate limiter", () => {
        it("allows the first 10 attempts in a window and denies the 11th (R1.9)", () => {
            const limiter = new InMemoryRateLimiter();
            try {
                const key = "ip:198.51.100.7";

                const results = Array.from({ length: 11 }, () =>
                    limiter.check(key, LOGIN_RATE_LIMIT),
                );

                for (let i = 0; i < 10; i++) {
                    expect(results[i]?.allowed).toBe(true);
                }

                expect(results[10]?.allowed).toBe(false);
                expect(results[10]?.remaining).toBe(0);
            } finally {
                // Clean up the periodic sweep timer to avoid pending handles.
                limiter.dispose();
            }
        });
    });
});

describe.skipIf(dockerAvailable)("auth integration (Testcontainers)", () => {
    it.skip("requires Docker to run; skipped because docker is not available", () => {
        /* Docker not detected; the real suite above is skipped. */
    });
});
