/**
 * Integration test (Testcontainers) — Properties 7 & 8 of `nextTicketId`.
 *
 * The unit suite (`tests/unit/lib/ticket-id.test.ts`) covers formatting,
 * prefix validation and driver-shape tolerance with a stubbed `Database`.
 * Sequential monotonicity (R9.4) and concurrent uniqueness (R9.3) cannot
 * be validated against a stub: they depend on the atomic semantics of
 * Postgres' `nextval`. This suite spins up an ephemeral Postgres 16
 * container, creates the `ticket_seq` sequence and exercises both
 * properties against a real database.
 *
 *   Property 7 — sequential calls produce strictly increasing integers.
 *   Property 8 — N concurrent calls (Promise.all) produce N distinct IDs.
 *
 * The suite skips gracefully when Docker is not reachable (CI without
 * Docker, devs without Docker Desktop running). Skipping is decided
 * inside `beforeAll`: if `PostgreSqlContainer.start()` throws, the
 * `dockerAvailable` flag stays `false` and each test calls `ctx.skip()`
 * instead of failing.
 *
 * Validates: Requirements 9.3, 9.4
 */

import {
    afterAll,
    beforeAll,
    describe,
    expect,
    it,
    type TestContext,
} from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import {
    PostgreSqlContainer,
    type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";

import type { Database } from "@/db/client";
import { nextTicketId } from "@/lib/ticket-id";

// ---------------------------------------------------------------------------
// Suite-level state
// ---------------------------------------------------------------------------

/**
 * Started container handle. `undefined` until `beforeAll` succeeds; remains
 * `undefined` if Docker is not available so `afterAll` can short-circuit.
 */
let container: StartedPostgreSqlContainer | undefined;

/** Pool sized large enough that 50 concurrent `nextval` calls do not queue
 * indefinitely. Sequence atomicity holds regardless of pool size, but a
 * larger pool exercises more parallelism in the driver, which is the
 * scenario Property 8 is meant to stress. */
let pool: Pool | undefined;

let db: Database | undefined;

/** Set to `true` only after the container is up and the sequence is
 * created. Tests check this flag via `ctx.skip()` to skip gracefully when
 * Docker is unavailable. */
let dockerAvailable = false;

const POOL_MAX = 20;
const IMAGE = "postgres:16-alpine";

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
    try {
        container = await new PostgreSqlContainer(IMAGE).start();

        pool = new Pool({
            connectionString: container.getConnectionUri(),
            max: POOL_MAX,
        });

        // Probe the connection. If this throws, the catch below cleans up
        // the partially-initialised resources before re-flagging as
        // unavailable.
        await pool.query("SELECT 1");

        // Bootstrap: create the sequence directly. The unit under test only
        // needs `ticket_seq` to exist; running the full Drizzle migration is
        // unnecessary overhead for this isolated property check.
        // The starting value matches `src/db/sql/0001_ticket_seq.sql` for
        // parity with production, though Properties 7 & 8 do not depend on
        // any specific starting value — only on monotonicity and uniqueness.
        await pool.query(
            "CREATE SEQUENCE IF NOT EXISTS ticket_seq START WITH 1042 INCREMENT BY 1",
        );

        // Cast is safe: `Database = typeof drizzle(pool)` for the same
        // node-postgres driver used in `src/db/client.ts`.
        db = drizzle(pool) as unknown as Database;

        dockerAvailable = true;
    } catch (err) {
        dockerAvailable = false;

        // Best-effort cleanup of any partial state so we do not leak
        // containers/pools when setup fails halfway through.
        if (pool) {
            try {
                await pool.end();
            } catch {
                /* ignore */
            }
            pool = undefined;
        }
        if (container) {
            try {
                await container.stop();
            } catch {
                /* ignore */
            }
            container = undefined;
        }

        // Surface the reason in the test output so devs can tell the
        // difference between "Docker not running" and a real failure.
        const reason = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-console
        console.warn(
            `[ticket-id integration] Docker unavailable — skipping suite. Reason: ${reason}`,
        );
    }
}, 120_000);

afterAll(async () => {
    if (pool) {
        try {
            await pool.end();
        } catch {
            /* ignore shutdown errors */
        }
    }
    if (container) {
        try {
            await container.stop();
        } catch {
            /* ignore shutdown errors */
        }
    }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Skips the test when Docker is unavailable. Returns the narrowed `Database`
 * for ergonomic use in the test body (TypeScript cannot use an `asserts ...`
 * function on module-level variables; returning the value is cleaner).
 */
function requireDb(ctx: TestContext): Database {
    if (!dockerAvailable || !db) {
        ctx.skip();
        // ctx.skip() throws to abort the test; this is unreachable but
        // satisfies TypeScript's control flow analysis.
        throw new Error("unreachable: ctx.skip() throws");
    }
    return db;
}

/**
 * Parses the numeric suffix of a `NVD-{n}` identifier. Uses `BigInt` to
 * avoid precision loss for large sequence values — the sequence is unbounded
 * in principle, even if test runs only consume a few thousand values.
 */
function parseSuffix(id: string): bigint {
    const match = /^NVD-([1-9][0-9]*)$/.exec(id);
    expect(match, `id ${JSON.stringify(id)} does not match /^NVD-\\d+$/`).not.toBeNull();
    return BigInt(match![1]!);
}

// ---------------------------------------------------------------------------
// Property 7 — sequential calls produce strictly increasing integers
// ---------------------------------------------------------------------------

describe("nextTicketId (integration) — Property 7: sequential monotonicity (R9.4)", () => {
    const N_SEQUENTIAL = 100;

    it(`${N_SEQUENTIAL} sequential calls produce strictly increasing integer suffixes`, async (ctx) => {
        const dbActive = requireDb(ctx);

        const ids: string[] = [];
        for (let i = 0; i < N_SEQUENTIAL; i++) {
            ids.push(await nextTicketId("NVD", dbActive));
        }

        // All match the format and parse to positive bigints.
        const suffixes = ids.map(parseSuffix);
        expect(suffixes).toHaveLength(N_SEQUENTIAL);

        // Strictly increasing: every neighbour pair (a, b) satisfies a < b.
        for (let i = 1; i < N_SEQUENTIAL; i++) {
            const prev = suffixes[i - 1]!;
            const curr = suffixes[i]!;
            expect(
                curr > prev,
                `sequential call #${i} produced ${curr} after ${prev}; expected strictly greater`,
            ).toBe(true);
        }
    });
});

// ---------------------------------------------------------------------------
// Property 8 — N concurrent calls produce N distinct IDs
// ---------------------------------------------------------------------------

describe("nextTicketId (integration) — Property 8: concurrent uniqueness (R9.3)", () => {
    const N_CONCURRENT = 50;

    it(`${N_CONCURRENT} concurrent calls (Promise.all) produce ${N_CONCURRENT} distinct IDs`, async (ctx) => {
        const dbActive = requireDb(ctx);

        const ids = await Promise.all(
            Array.from({ length: N_CONCURRENT }, () => nextTicketId("NVD", dbActive)),
        );

        // Sanity: every result has the canonical `NVD-{n}` shape.
        for (const id of ids) {
            expect(id).toMatch(/^NVD-[1-9][0-9]*$/);
        }

        // Core property: all values are pairwise distinct. We compare on the
        // string form because `nextTicketId` is what callers actually consume;
        // distinctness of the formatted IDs implies distinctness of the
        // underlying sequence values.
        const distinct = new Set(ids);
        expect(
            distinct.size,
            `expected ${N_CONCURRENT} distinct IDs but got ${distinct.size}; duplicates indicate a sequence/concurrency bug`,
        ).toBe(N_CONCURRENT);
    });
});
