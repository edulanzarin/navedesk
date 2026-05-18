/**
 * Integration test (Testcontainers) — Property 12: conservação de mensagens.
 *
 * Property statement (design § Property 12):
 *
 *   ∀ ticket t, body b:
 *     postMessage(actor, t.id, { body = b, isInternal = false })
 *       ⟹ count_after(t.id) = count_before(t.id) + 1
 *          ∧ messages(t.id).orderBy(createdAt DESC).first.body = b
 *
 * Why an integration suite — `postMessage` orchestrates RBAC, a default
 * `now()` timestamp from Postgres and the `RETURNING` row from a single
 * INSERT into `ticket_messages`. A unit stub would replay the
 * implementation rather than test the property, because conservation
 * depends on the underlying SQL semantics (atomic insert, monotonic
 * `createdAt`, primary-key returned row). A real Postgres container
 * exercises all three together.
 *
 * Coverage notes
 *   - The headline property uses `fast-check` to randomise the message
 *     body (1..1000 chars after `trim`, never empty). Each iteration
 *     captures `count_before`, calls the service as the tecnico, then
 *     re-counts and asserts the count grew by exactly one. To make the
 *     "the latest is the inserted one" leg precise we look up the most
 *     recent row (`created_at DESC, id DESC`) and compare both its
 *     primary-key id (against the row returned by the service) and its
 *     body (against the input). This catches a class of regressions
 *     where the INSERT writes the wrong body or where ordering by
 *     `createdAt` is unstable.
 *   - We deliberately do NOT truncate `ticket_messages` between
 *     iterations: the count grows monotonically and the property is
 *     exercised at a wider variety of initial counts than a fresh
 *     start would allow. The before/after delta makes this safe.
 *   - `numRuns` is kept modest (15) — each iteration touches the DB
 *     three times (count, insert, count + select) so wall time scales
 *     linearly with runs. 15 runs is enough to sample the body domain
 *     without dragging the integration budget.
 *
 * Skips gracefully when Docker is unreachable (CI without Docker, devs
 * without Docker Desktop running). The decision is made inside
 * `beforeAll`: if `PostgreSqlContainer.start()` throws, the
 * `dockerAvailable` flag stays `false` and each test calls `ctx.skip()`.
 *
 * Validates: Requirements 7.1, 7.7
 */

import {
    afterAll,
    beforeAll,
    describe,
    expect,
    it,
    type TestContext,
} from "vitest";
import fc from "fast-check";
import { Pool } from "pg";
import {
    PostgreSqlContainer,
    type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";

import { runMigrations } from "@/db/migrate";
import type { postMessage as PostMessageFn } from "@/services/messages.service";
import type { SessionUser } from "@/types/domain";

// ---------------------------------------------------------------------------
// Suite-level state
// ---------------------------------------------------------------------------

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool | undefined;

/**
 * `messages.service.postMessage` is loaded via dynamic `import()` because
 * the module transitively imports `@/db/client`, whose module-level guard
 * throws on missing `DATABASE_URL`. We must set that env var **after** the
 * container starts and **before** importing the service.
 */
let postMessage: typeof PostMessageFn | undefined;

/**
 * The pool internally opened by `@/db/client` once the service module is
 * imported. We hold a reference so `afterAll` can close it cleanly before
 * stopping the container — otherwise the lingering connections trip a
 * `57P01 — terminating connection due to administrator command` notice
 * when Postgres tears down, surfacing as an "unhandled error" in vitest.
 */
let internalPool: Pool | undefined;

/** `true` once the container is up, migrations applied and seed inserted. */
let dockerAvailable = false;

/** Seed identifiers populated in `beforeAll` and consumed by every test. */
const SEED = {
    deptId: "",
    categoryId: "sistema",
    solId: "",
    tecId: "",
    /** Single ticket the property targets; format `NVD-XXXX` per R9.1. */
    ticketId: "NVD-1042",
};

const POOL_MAX = 8;
const IMAGE = "postgres:16-alpine";

/**
 * `password_hash` is `NOT NULL` but the property does not exercise auth,
 * so a recognisable placeholder is enough — bypassing the bcrypt(cost=12)
 * round-trip keeps suite startup fast.
 */
const PLACEHOLDER_HASH =
    "$2b$12$placeholder.placeholder.placeholder.placeholder.placeholder";

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
    try {
        container = await new PostgreSqlContainer(IMAGE).start();

        const connectionString = container.getConnectionUri();

        // Satisfy the `DATABASE_URL` guard in `@/db/client` so the dynamic
        // import below doesn't throw. The service-internal `db` instance
        // built from this URL targets the same container as our `pool`.
        process.env.DATABASE_URL = connectionString;

        pool = new Pool({
            connectionString,
            max: POOL_MAX,
        });
        await pool.query("SELECT 1");

        // Apply the production migrations (Drizzle + manual SQL). This is
        // the same path `pnpm db:migrate` exercises, so the schema seen by
        // `postMessage` here is identical to production.
        await runMigrations(pool, { log: () => undefined });

        // ---- Bootstrap minimal reference data ----------------------------
        // We bypass `seedIfEmpty` because the property only needs one
        // tecnico and one solicitante; running the demo seed would do extra
        // bcrypt work for users we never touch.

        // 1 department.
        const dept = await pool.query<{ id: string }>(
            `INSERT INTO departments (name) VALUES ('TI') RETURNING id`,
        );
        SEED.deptId = dept.rows[0]!.id;

        // 1 category.
        await pool.query(
            `INSERT INTO categories (id, label, sub, icon)
             VALUES ($1, 'Sistema', 'Sistemas internos', 'cog')`,
            [SEED.categoryId],
        );

        // 4 SLA policies (one per priority — the FK on `tickets.priority`
        // does not require this, but matching the production seed keeps
        // the schema invariants exercised by the migration realistic).
        await pool.query(
            `INSERT INTO sla_policies (priority, minutes) VALUES
                ('baixa', 2880),
                ('media', 1440),
                ('alta', 480),
                ('critica', 120)`,
        );

        // 2 users: 1 solicitante (the requester) and 1 tecnico (the actor
        // posting messages). The tecnico is also the assignee so
        // `canViewTicket` and `canPostInternalNote` both pass for any
        // future variation of the suite.
        const sol = await pool.query<{ id: string }>(
            `INSERT INTO users (email, password_hash, name, role, department_id)
             VALUES ($1, $2, 'Solicitante', 'solicitante', $3) RETURNING id`,
            ["sol@navedesk.test", PLACEHOLDER_HASH, SEED.deptId],
        );
        SEED.solId = sol.rows[0]!.id;

        const tec = await pool.query<{ id: string }>(
            `INSERT INTO users (email, password_hash, name, role, department_id)
             VALUES ($1, $2, 'Tecnico', 'tecnico', $3) RETURNING id`,
            ["tec@navedesk.test", PLACEHOLDER_HASH, SEED.deptId],
        );
        SEED.tecId = tec.rows[0]!.id;

        // 1 ticket via direct INSERT — we never invoke `nextTicketId`, so
        // the `ticket_seq` sequence does not need to be advanced (the
        // task allows skipping `setval` in this case). The ticket is in
        // `andamento` with the tecnico as assignee so RBAC permits both
        // public messages and internal notes (only public messages are
        // exercised here, matching R7.1).
        const slaDeadline = new Date(Date.UTC(2025, 0, 2));
        await pool.query(
            `INSERT INTO tickets
                (id, title, description, status, priority,
                 category_id, department_id, requester_id, assignee_id,
                 sla_deadline)
             VALUES ($1, $2, $3, $4, $5,
                     $6, $7, $8, $9, $10)`,
            [
                SEED.ticketId,
                "Ticket conversacional",
                "Descrição do ticket para teste de conservação de mensagens.",
                "andamento",
                "media",
                SEED.categoryId,
                SEED.deptId,
                SEED.solId,
                SEED.tecId,
                slaDeadline,
            ],
        );

        // Deferred until DATABASE_URL is set so the module-level guard in
        // `@/db/client` accepts the load. The service's internal `db`
        // wraps a brand-new `Pool` over the same connection string — that
        // is fine, both pools target the same Postgres process.
        const mod = await import("@/services/messages.service");
        postMessage = mod.postMessage;

        // Capture the internal pool so we can close it in `afterAll`
        // before stopping the container; the import side-effect above
        // already opened it.
        const clientMod = await import("@/db/client");
        internalPool = clientMod.pool;

        dockerAvailable = true;
    } catch (err) {
        dockerAvailable = false;

        // Best-effort cleanup of partially-initialised resources.
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

        const reason = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-console
        console.warn(
            `[messages.conservation] Docker unavailable — skipping suite. Reason: ${reason}`,
        );
    }
}, 180_000);

afterAll(async () => {
    if (internalPool) {
        try {
            await internalPool.end();
        } catch {
            /* ignore shutdown errors */
        }
    }
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
 * Skips the test when Docker is unavailable. Returns the narrowed
 * dependencies the test body needs.
 */
function requireSetup(ctx: TestContext): {
    postMessage: typeof PostMessageFn;
    pool: Pool;
    tec: SessionUser;
    ticketId: string;
} {
    if (!dockerAvailable || !pool || !postMessage) {
        ctx.skip();
        throw new Error("unreachable: ctx.skip() throws");
    }
    return {
        postMessage,
        pool,
        tec: {
            id: SEED.tecId,
            email: "tec@navedesk.test",
            name: "Tecnico",
            role: "tecnico",
            departmentId: SEED.deptId,
        },
        ticketId: SEED.ticketId,
    };
}

/**
 * Counts persisted messages for a ticket. We project `COUNT(*)::text` so
 * the `pg` driver returns a string we can `Number()` deterministically —
 * `BIGINT` is otherwise serialised as a string by default and would
 * compare oddly against `before + 1`.
 */
async function countMessages(p: Pool, ticketId: string): Promise<number> {
    const res = await p.query<{ c: string }>(
        "SELECT COUNT(*)::text AS c FROM ticket_messages WHERE ticket_id = $1",
        [ticketId],
    );
    return Number(res.rows[0]!.c);
}

interface LatestRow {
    id: string;
    body: string;
}

/**
 * Most recent message for a ticket. We tiebreak on `id DESC` because the
 * `(created_at)` resolution can collapse to the same microsecond on
 * fast inserts; the secondary key keeps the read deterministic without
 * weakening the property — the message returned by the service has a
 * unique uuid and we compare on it explicitly.
 */
async function latestMessage(
    p: Pool,
    ticketId: string,
): Promise<LatestRow | undefined> {
    const res = await p.query<LatestRow>(
        `SELECT id, body
         FROM ticket_messages
         WHERE ticket_id = $1
         ORDER BY created_at DESC, id DESC
         LIMIT 1`,
        [ticketId],
    );
    return res.rows[0];
}

/**
 * Body arbitrary — strings of 1..1000 characters after `trim`, never
 * collapsing to empty. The service receives `PostMessageInput` already
 * "trusted" by the caller (Zod parsing happens in the Server Action),
 * so we feed it bodies that satisfy the schema invariant directly: a
 * non-empty trimmed string within bounds. Whitespace-only inputs get
 * substituted with a single non-space character — they correspond to a
 * Zod-rejected slice of the input space and are off-property.
 */
const bodyArb: fc.Arbitrary<string> = fc
    .string({ minLength: 1, maxLength: 1000 })
    .map((s) => {
        const trimmed = s.trim();
        return trimmed.length === 0 ? "m" : trimmed;
    });

// ---------------------------------------------------------------------------
// Property 12 — conservação de mensagens
// ---------------------------------------------------------------------------

describe("postMessage — Property 12: conservação de mensagens (R7.1, R7.7)", () => {
    it(
        "for any random body, the message count grows by exactly 1 and the inserted body is the most recent",
        async (ctx) => {
            const {
                postMessage: post,
                pool: p,
                tec,
                ticketId,
            } = requireSetup(ctx);

            // 15 runs strikes the balance the task requested: enough to
            // sample the body domain (varying length, whitespace, unicode)
            // without inflating the integration budget. Each iteration
            // touches the DB three times (count, INSERT via service,
            // count + ORDER BY LIMIT 1).
            await fc.assert(
                fc.asyncProperty(bodyArb, async (body) => {
                    const before = await countMessages(p, ticketId);

                    const result = await post(tec, ticketId, {
                        body,
                        isInternal: false,
                    });

                    // The service should never reject a public message
                    // posted by the assignee tecnico against a ticket
                    // they can view. A failure here means the seed is
                    // inconsistent or RBAC regressed — surface it as a
                    // property failure, not as a silent skip, so
                    // fast-check captures the offending body.
                    if (!result.ok) {
                        throw new Error(
                            `postMessage failed unexpectedly: ${result.error.code} — ${result.error.message}`,
                        );
                    }

                    const after = await countMessages(p, ticketId);
                    expect(
                        after,
                        `expected count to grow by exactly 1 (was ${before}, now ${after})`,
                    ).toBe(before + 1);

                    const last = await latestMessage(p, ticketId);
                    expect(
                        last,
                        "expected at least one message after a successful insert",
                    ).toBeDefined();

                    // Strongest version of the "most recent is the
                    // inserted one" leg: compare on the row's
                    // primary key against the service's returned row.
                    expect(
                        last!.id,
                        "the most recent row by createdAt should be the inserted message",
                    ).toBe(result.data.id);

                    // And the persisted body must match the input —
                    // catches regressions where the INSERT writes a
                    // mutated body (e.g. accidental trim or sanitise).
                    expect(
                        last!.body,
                        "the most recent row's body should equal the inserted body",
                    ).toBe(body);
                }),
                { numRuns: 15 },
            );
        },
        120_000,
    );
});
