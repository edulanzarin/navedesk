/**
 * Integration test (Testcontainers) — `services/tickets.service`.
 *
 * This suite exercises the four *hard* invariants of the tickets service
 * end-to-end against a real Postgres 16: the production code paths that
 * combine Zod validation, RBAC, the pure state machine
 * (`lib/ticket-state`), the SLA calculator (`lib/sla`), the sequence-backed
 * ID generator (`lib/ticket-id`) and the audit-trail writer
 * (`repositories/events.repo`) into a single transactional pipeline. Unit
 * mocks would, by construction, skip the transactional contract these
 * tests want to validate, so a real DB is required.
 *
 * Coverage:
 *   1. Happy path full lifecycle — verifies the audit trail (R16) is
 *      written once per state-changing operation, including the dual
 *      events produced by `assignTicketToMe` (`assigned` + implicit
 *      `aberto → andamento` `status_changed`) and the dual events
 *      produced by closing a ticket (`status_changed` + `closed`,
 *      R16.7).
 *   2. RBAC — confirms that the SQL filter inside `findVisibleForUser`
 *      keeps a foreign solicitante out of any state-changing API.
 *      `NOT_FOUND` is the canonical response (R12.7), indistinguishable
 *      from "ticket does not exist" to prevent ID enumeration.
 *   3. Transactional rollback — when `linkToTicket` rejects an attachment
 *      (unknown uuid) the service must surface `ATTACHMENT_INVALID` *and*
 *      leave no rows in `tickets` or `ticket_events`. The `ticket_seq`
 *      sequence is allowed to advance because Postgres sequences are
 *      not transactional; the property under test is row persistence,
 *      not sequence rewinding.
 *   4. Illegal transition — the state machine rejects `fechado →
 *      andamento`. The service must translate
 *      `IllegalStateTransitionError` into `INVALID_TRANSITION` and not
 *      mutate the ticket. The actor here is a tecnico-assignee so RBAC
 *      passes and we observe the state machine's verdict, not a
 *      `FORBIDDEN`.
 *
 * Skips gracefully when Docker is unreachable — same pattern as
 * `messages.conservation.test.ts`. The decision is made inside `beforeAll`:
 * if `PostgreSqlContainer.start()` throws, `dockerAvailable` stays
 * `false` and each test calls `ctx.skip()`.
 *
 * Validates: Requirements 3, 4, 5, 16
 */

import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    type TestContext,
} from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import {
    PostgreSqlContainer,
    type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";

import { runMigrations } from "@/db/migrate";
import type {
    assignTicketToMe as AssignTicketToMeFn,
    changeTicketPriority as ChangeTicketPriorityFn,
    changeTicketStatus as ChangeTicketStatusFn,
    createTicket as CreateTicketFn,
    rateTicket as RateTicketFn,
} from "@/services/tickets.service";
import type { SessionUser } from "@/types/domain";

// ---------------------------------------------------------------------------
// Suite-level state
// ---------------------------------------------------------------------------

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool | undefined;

/**
 * Service handles loaded via dynamic `import()` — see the rationale in
 * `messages.conservation.test.ts`: `@/db/client` throws at module load
 * when `DATABASE_URL` is missing, so we must set the env var **after**
 * the container starts and **before** importing the service.
 */
let createTicket: typeof CreateTicketFn | undefined;
let assignTicketToMe: typeof AssignTicketToMeFn | undefined;
let changeTicketPriority: typeof ChangeTicketPriorityFn | undefined;
let changeTicketStatus: typeof ChangeTicketStatusFn | undefined;
let rateTicket: typeof RateTicketFn | undefined;

/**
 * Reference to the pool opened internally by `@/db/client` once the
 * service module is imported — held so `afterAll` can close it before
 * stopping the container, avoiding the `57P01` shutdown notice.
 */
let internalPool: Pool | undefined;

/** `true` once the container is up, migrations applied and seed inserted. */
let dockerAvailable = false;

/** Seed identifiers populated in `beforeAll` and consumed by every test. */
const SEED = {
    deptId: "",
    categoryId: "sistema",
    sol1Id: "",
    sol2Id: "",
    tecId: "",
};

const POOL_MAX = 8;
const IMAGE = "postgres:16-alpine";

/**
 * `password_hash` is `NOT NULL` but the suite does not exercise auth, so
 * a recognisable placeholder is enough — bypassing the bcrypt(cost=12)
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

        // Satisfy the `DATABASE_URL` guard in `@/db/client` so the
        // dynamic import below doesn't throw. The service-internal
        // `db` instance built from this URL targets the same container
        // as our `pool`.
        process.env.DATABASE_URL = connectionString;

        pool = new Pool({
            connectionString,
            max: POOL_MAX,
        });
        await pool.query("SELECT 1");

        // Apply the production migrations (Drizzle + manual SQL). This
        // is the same path `pnpm db:migrate` exercises, so the schema
        // seen by the service here is identical to production —
        // including the `ticket_seq` sequence used by `nextTicketId`.
        await runMigrations(pool, { log: () => undefined });

        // ---- Bootstrap reference data ------------------------------------
        // We bypass `seedIfEmpty` because the suite needs a controlled
        // set of users (one tecnico, two distinct solicitantes) and
        // the demo seed would do extra bcrypt work for users we never
        // touch.

        const dept = await pool.query<{ id: string }>(
            `INSERT INTO departments (name) VALUES ('TI') RETURNING id`,
        );
        SEED.deptId = dept.rows[0]!.id;

        await pool.query(
            `INSERT INTO categories (id, label, sub, icon)
             VALUES ($1, 'Sistema', 'Sistemas internos', 'cog')`,
            [SEED.categoryId],
        );

        // 4 SLA policies — one per priority. The tickets table FK on
        // `priority` is satisfied by the enum, but `loadAllPolicies`
        // inside `createTicket` reads from this table to compute the
        // SLA deadline, so all four are required for any priority the
        // tests might exercise.
        await pool.query(
            `INSERT INTO sla_policies (priority, hours) VALUES
                ('baixa', 48),
                ('media', 24),
                ('alta', 8),
                ('critica', 2)`,
        );

        const tec = await pool.query<{ id: string }>(
            `INSERT INTO users (email, password_hash, name, role, department_id)
             VALUES ($1, $2, 'Tecnico', 'tecnico', $3) RETURNING id`,
            ["tec@navedesk.test", PLACEHOLDER_HASH, SEED.deptId],
        );
        SEED.tecId = tec.rows[0]!.id;

        const sol1 = await pool.query<{ id: string }>(
            `INSERT INTO users (email, password_hash, name, role, department_id)
             VALUES ($1, $2, 'Solicitante 1', 'solicitante', $3) RETURNING id`,
            ["sol1@navedesk.test", PLACEHOLDER_HASH, SEED.deptId],
        );
        SEED.sol1Id = sol1.rows[0]!.id;

        const sol2 = await pool.query<{ id: string }>(
            `INSERT INTO users (email, password_hash, name, role, department_id)
             VALUES ($1, $2, 'Solicitante 2', 'solicitante', $3) RETURNING id`,
            ["sol2@navedesk.test", PLACEHOLDER_HASH, SEED.deptId],
        );
        SEED.sol2Id = sol2.rows[0]!.id;

        // Deferred until DATABASE_URL is set so the module-level guard
        // in `@/db/client` accepts the load.
        const mod = await import("@/services/tickets.service");
        createTicket = mod.createTicket;
        assignTicketToMe = mod.assignTicketToMe;
        changeTicketPriority = mod.changeTicketPriority;
        changeTicketStatus = mod.changeTicketStatus;
        rateTicket = mod.rateTicket;

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
            `[tickets.service] Docker unavailable — skipping suite. Reason: ${reason}`,
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

/**
 * Each test owns its own ticket(s). Truncating between tests keeps the
 * lifecycle assertions in test 1 from leaking into the rollback counts
 * in test 3 (where we want `count == 0` before/after to mean "the
 * service rolled back this specific call"). `RESTART IDENTITY CASCADE`
 * is harmless — none of the tables in scope use IDENTITY columns.
 */
beforeEach(async () => {
    if (!dockerAvailable || !pool) return;
    await pool.query(
        "TRUNCATE TABLE attachments, ticket_messages, ticket_events, tickets RESTART IDENTITY CASCADE",
    );
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface Setup {
    createTicket: typeof CreateTicketFn;
    assignTicketToMe: typeof AssignTicketToMeFn;
    changeTicketPriority: typeof ChangeTicketPriorityFn;
    changeTicketStatus: typeof ChangeTicketStatusFn;
    rateTicket: typeof RateTicketFn;
    pool: Pool;
    sol1: SessionUser;
    sol2: SessionUser;
    tec: SessionUser;
}

/**
 * Skips the test when Docker is unavailable. Returns the narrowed
 * dependencies the test bodies need.
 */
function requireSetup(ctx: TestContext): Setup {
    if (
        !dockerAvailable ||
        !pool ||
        !createTicket ||
        !assignTicketToMe ||
        !changeTicketPriority ||
        !changeTicketStatus ||
        !rateTicket
    ) {
        ctx.skip();
        throw new Error("unreachable: ctx.skip() throws");
    }
    return {
        createTicket,
        assignTicketToMe,
        changeTicketPriority,
        changeTicketStatus,
        rateTicket,
        pool,
        sol1: {
            id: SEED.sol1Id,
            email: "sol1@navedesk.test",
            name: "Solicitante 1",
            role: "solicitante",
            departmentId: SEED.deptId,
        },
        sol2: {
            id: SEED.sol2Id,
            email: "sol2@navedesk.test",
            name: "Solicitante 2",
            role: "solicitante",
            departmentId: SEED.deptId,
        },
        tec: {
            id: SEED.tecId,
            email: "tec@navedesk.test",
            name: "Tecnico",
            role: "tecnico",
            departmentId: SEED.deptId,
        },
    };
}

/**
 * Standard CreateTicketInput fixture; tests override only what they need.
 * Title and description sit comfortably above the schema's `min` so a
 * shorter override (e.g. trimmed boundary cases) is the caller's choice.
 */
function ticketInput(overrides: {
    attachments?: string[];
    priority?: "baixa" | "media" | "alta" | "critica";
} = {}): {
    title: string;
    description: string;
    categoryId: string;
    priority: "baixa" | "media" | "alta" | "critica";
    departmentId: string;
    attachments: string[];
} {
    return {
        title: "Servidor caiu durante backup noturno",
        description:
            "O servidor de arquivos parou de responder durante o backup automático às 02:00.",
        categoryId: SEED.categoryId,
        priority: overrides.priority ?? "media",
        departmentId: SEED.deptId,
        attachments: overrides.attachments ?? [],
    };
}

/** Counts ticket rows; same `::text` projection trick as the messages suite. */
async function countTickets(p: Pool): Promise<number> {
    const r = await p.query<{ c: string }>(
        "SELECT COUNT(*)::text AS c FROM tickets",
    );
    return Number(r.rows[0]!.c);
}

/** Counts events for a specific ticket (or all when `ticketId` is omitted). */
async function countEvents(p: Pool, ticketId?: string): Promise<number> {
    if (ticketId === undefined) {
        const r = await p.query<{ c: string }>(
            "SELECT COUNT(*)::text AS c FROM ticket_events",
        );
        return Number(r.rows[0]!.c);
    }
    const r = await p.query<{ c: string }>(
        "SELECT COUNT(*)::text AS c FROM ticket_events WHERE ticket_id = $1",
        [ticketId],
    );
    return Number(r.rows[0]!.c);
}

/** Reads every event of a ticket in chronological order. */
async function listEventTypes(p: Pool, ticketId: string): Promise<string[]> {
    const r = await p.query<{ type: string }>(
        `SELECT type FROM ticket_events
         WHERE ticket_id = $1
         ORDER BY created_at ASC, id ASC`,
        [ticketId],
    );
    return r.rows.map((row) => row.type);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("services/tickets.service — integration (R3, R4, R5, R16)", () => {
    it(
        "happy path: full lifecycle writes one event per state-changing operation (R3, R4, R5, R16)",
        async (ctx) => {
            const s = requireSetup(ctx);

            // 1. solicitante1 opens the ticket. Initial state: aberto,
            //    requesterId = sol1, no assignee, priority = media.
            const created = await s.createTicket(s.sol1, ticketInput());
            expect(created.ok, JSON.stringify(created)).toBe(true);
            if (!created.ok) throw new Error("unreachable");
            const ticketId = created.data.id;
            expect(ticketId).toMatch(/^NVD-\d+$/);
            expect(created.data.status).toBe("aberto");
            expect(created.data.requesterId).toBe(s.sol1.id);
            expect(created.data.assigneeId).toBeNull();

            // 2. tecnico assumes the ticket. The state machine moves
            //    `aberto → andamento` and the service emits BOTH the
            //    `assigned` event and the implicit `status_changed`
            //    event (R5.2 + R16.4 + R16.2).
            const assigned = await s.assignTicketToMe(s.tec, ticketId);
            expect(assigned.ok, JSON.stringify(assigned)).toBe(true);
            if (!assigned.ok) throw new Error("unreachable");
            expect(assigned.data.status).toBe("andamento");
            expect(assigned.data.assigneeId).toBe(s.tec.id);

            // 3. tecnico reclassifies priority. SLA deadline is
            //    preserved (the service intentionally does not
            //    recompute it on priority change).
            const repriced = await s.changeTicketPriority(
                s.tec,
                ticketId,
                "alta",
            );
            expect(repriced.ok, JSON.stringify(repriced)).toBe(true);
            if (!repriced.ok) throw new Error("unreachable");
            expect(repriced.data.priority).toBe("alta");
            expect(repriced.data.slaDeadline.getTime()).toBe(
                created.data.slaDeadline.getTime(),
            );

            // 4. tecnico marks it resolvido. `resolvedAt` is set.
            const resolved = await s.changeTicketStatus(
                s.tec,
                ticketId,
                "resolvido",
            );
            expect(resolved.ok, JSON.stringify(resolved)).toBe(true);
            if (!resolved.ok) throw new Error("unreachable");
            expect(resolved.data.status).toBe("resolvido");
            expect(resolved.data.resolvedAt).not.toBeNull();

            // 5. solicitante1 rates the resolved ticket.
            const rated = await s.rateTicket(s.sol1, ticketId, 5);
            expect(rated.ok, JSON.stringify(rated)).toBe(true);
            if (!rated.ok) throw new Error("unreachable");
            expect(rated.data.rating).toBe(5);

            // 6. solicitante1 confirms closure (`canChangeStatus` allows
            //    the requester to close their own resolvido ticket —
            //    R12.6). The service emits BOTH `status_changed` and a
            //    dedicated `closed` event (R16.7).
            const closed = await s.changeTicketStatus(
                s.sol1,
                ticketId,
                "fechado",
            );
            expect(closed.ok, JSON.stringify(closed)).toBe(true);
            if (!closed.ok) throw new Error("unreachable");
            expect(closed.data.status).toBe("fechado");
            expect(closed.data.closedAt).not.toBeNull();

            // ---- Audit trail assertions -------------------------------
            // Expected sequence:
            //   created                 (createTicket)
            //   assigned                (assignTicketToMe)
            //   status_changed          (assignTicketToMe: aberto→andamento)
            //   priority_changed        (changeTicketPriority)
            //   status_changed          (changeTicketStatus: andamento→resolvido)
            //   rated                   (rateTicket)
            //   status_changed          (changeTicketStatus: resolvido→fechado)
            //   closed                  (changeTicketStatus, R16.7)
            //
            // We assert (a) the cardinality (8 events), (b) the
            // multiplicity of `status_changed` (3 occurrences), and (c)
            // that every required type appears at least once. We do
            // NOT assert the strict ordering between two events that
            // share the same logical "step" (e.g. `assigned` vs the
            // implicit `status_changed`) because their `created_at`
            // values can collapse to the same microsecond inside a
            // transaction; the property under test is "one event per
            // state change", not "stable inter-event ordering".
            const types = await listEventTypes(s.pool, ticketId);
            expect(types).toHaveLength(8);

            const counts = types.reduce<Record<string, number>>((acc, t) => {
                acc[t] = (acc[t] ?? 0) + 1;
                return acc;
            }, {});

            expect(counts.created).toBe(1);
            expect(counts.assigned).toBe(1);
            expect(counts.status_changed).toBe(3);
            expect(counts.priority_changed).toBe(1);
            expect(counts.rated).toBe(1);
            expect(counts.closed).toBe(1);

            // The `created` event is always first — it is the only one
            // emitted at INSERT time and predates every other write.
            expect(types[0]).toBe("created");
        },
        60_000,
    );

    it(
        "RBAC: solicitante2 cannot operate on solicitante1's ticket — receives NOT_FOUND (R2.4, R12.7)",
        async (ctx) => {
            const s = requireSetup(ctx);

            // sol1 owns the ticket; sol2 is a foreign solicitante.
            const created = await s.createTicket(s.sol1, ticketInput());
            expect(created.ok).toBe(true);
            if (!created.ok) throw new Error("unreachable");
            const ticketId = created.data.id;

            // Snapshot the audit trail before the foreign call so we
            // can prove no side effect leaked through despite the
            // rejection.
            const eventsBefore = await countEvents(s.pool, ticketId);

            // changeTicketStatus is the canonical state-changing API
            // for tickets.service. `findVisibleForUser` filters
            // solicitantes by `requesterId`, so sol2 sees nothing —
            // the service collapses the lookup miss into NOT_FOUND
            // rather than FORBIDDEN to avoid ID enumeration (R12.7).
            const rejected = await s.changeTicketStatus(
                s.sol2,
                ticketId,
                "andamento",
            );
            expect(rejected.ok).toBe(false);
            if (rejected.ok) throw new Error("unreachable");
            expect(rejected.error.code).toBe("NOT_FOUND");

            // Same expectation for `rateTicket` — covers the
            // requester-only API surface, ensuring the visibility
            // check is consistent across every operation in the
            // service (sister of "listMessages/changeStatus" in the
            // RBAC requirement). `listMessagesForUser` lives in
            // `messages.service` and is exercised by its own suite.
            const ratingRejected = await s.rateTicket(s.sol2, ticketId, 5);
            expect(ratingRejected.ok).toBe(false);
            if (ratingRejected.ok) throw new Error("unreachable");
            expect(ratingRejected.error.code).toBe("NOT_FOUND");

            // The ticket is intact and untouched; sol1's assertions
            // should still hold and no event was appended.
            const r = await s.pool.query<{ status: string }>(
                "SELECT status FROM tickets WHERE id = $1",
                [ticketId],
            );
            expect(r.rows[0]!.status).toBe("aberto");
            expect(await countEvents(s.pool, ticketId)).toBe(eventsBefore);
        },
        60_000,
    );

    it(
        "transactional rollback: an unknown attachment uuid yields ATTACHMENT_INVALID and persists no rows (R3.5, R3.6, R16.1)",
        async (ctx) => {
            const s = requireSetup(ctx);

            const ticketsBefore = await countTickets(s.pool);
            const eventsBefore = await countEvents(s.pool);

            // A randomly generated uuid that has never been inserted
            // into `attachments`. `linkToTicket` returns null and the
            // service raises `AttachmentLinkError` inside the
            // transaction, rolling back BOTH the `tickets` INSERT and
            // the `created` event INSERT — that's the conservation
            // property under test.
            const unknownAttachment = randomUUID();
            const result = await s.createTicket(
                s.sol1,
                ticketInput({ attachments: [unknownAttachment] }),
            );

            expect(result.ok).toBe(false);
            if (result.ok) throw new Error("unreachable");
            expect(result.error.code).toBe("ATTACHMENT_INVALID");
            expect(result.error.field).toBe("attachments");

            // Conservation: the row counts must be exactly what they
            // were before the call. `ticket_seq` is allowed to advance
            // (Postgres sequences are NOT transactional and that's
            // intentional — they trade rare gaps for atomicity); the
            // assertion targets persisted rows, which are.
            expect(await countTickets(s.pool)).toBe(ticketsBefore);
            expect(await countEvents(s.pool)).toBe(eventsBefore);
        },
        60_000,
    );

    it(
        "illegal transition: a closed ticket rejects status changes with INVALID_TRANSITION (R4.8, R4.9)",
        async (ctx) => {
            const s = requireSetup(ctx);

            // Walk a ticket through the legal path until `fechado`.
            // The tecnico is the assignee, so `canChangeStatus`
            // returns true for the closed → andamento attempt below
            // and what we observe is the state machine's verdict, not
            // an RBAC rejection.
            const created = await s.createTicket(s.sol1, ticketInput());
            expect(created.ok).toBe(true);
            if (!created.ok) throw new Error("unreachable");
            const ticketId = created.data.id;

            const assigned = await s.assignTicketToMe(s.tec, ticketId);
            expect(assigned.ok).toBe(true);

            const resolved = await s.changeTicketStatus(
                s.tec,
                ticketId,
                "resolvido",
            );
            expect(resolved.ok).toBe(true);

            const closed = await s.changeTicketStatus(
                s.sol1,
                ticketId,
                "fechado",
            );
            expect(closed.ok).toBe(true);
            if (!closed.ok) throw new Error("unreachable");
            expect(closed.data.status).toBe("fechado");

            const eventsBeforeIllegal = await countEvents(s.pool, ticketId);

            // The illegal attempt: `fechado → andamento` has no
            // canonical action in the transition table, so
            // `deriveAction` throws `IllegalStateTransitionError` and
            // the service maps it to `INVALID_TRANSITION` (R4.8).
            const illegal = await s.changeTicketStatus(
                s.tec,
                ticketId,
                "andamento",
            );
            expect(illegal.ok).toBe(false);
            if (illegal.ok) throw new Error("unreachable");
            expect(illegal.error.code).toBe("INVALID_TRANSITION");

            // The ticket stayed in `fechado` and no audit event was
            // appended — the rejection happens BEFORE the transaction
            // opens.
            const r = await s.pool.query<{ status: string }>(
                "SELECT status FROM tickets WHERE id = $1",
                [ticketId],
            );
            expect(r.rows[0]!.status).toBe("fechado");
            expect(await countEvents(s.pool, ticketId)).toBe(
                eventsBeforeIllegal,
            );
        },
        60_000,
    );
});
