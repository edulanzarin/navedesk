/**
 * Integration test (Testcontainers) — Property 10: solicitante só vê os
 * próprios tickets.
 *
 * Property statement (design § Property 10):
 *
 *   ∀ u onde u.role = "solicitante", t:
 *     listWithFilters(db, u, filters).rows.contains(t) ⟹ t.requesterId === u.id
 *
 * The unit suite for `tickets.repo` cannot validate this end-to-end:
 * the RBAC scoping is implemented as an extra `WHERE requester_id = $1`
 * clause appended to the SQL when `user.role === "solicitante"`. Stubbing
 * the executor would only re-state the implementation. This suite spins
 * up an ephemeral Postgres 16 container, applies the production
 * migrations and exercises the property against a real database with a
 * mixed fixture of tickets distributed across two distinct solicitantes
 * and a tecnico.
 *
 * Coverage notes
 *   - The headline property uses `fast-check` to randomise the
 *     distribution of `requesterId` and `assigneeId` across a small
 *     batch of tickets. Each iteration truncates the `tickets` table
 *     and re-inserts the generated batch, then asserts the universal
 *     property on the result of `listWithFilters(db, sol1, {})`.
 *   - Two deterministic regression checks exercise the two natural
 *     attack vectors that the RBAC override must defeat:
 *       1. A solicitante sending `filters.requesterId = otherUserId` —
 *          the SQL must ignore it (R11.4 explicitly says the implicit
 *          filter overrides the user-supplied one).
 *       2. A solicitante sending `filters.assigneeId = "me"` — must
 *          still scope by `requesterId = u.id`.
 *
 * Skips gracefully when Docker is unreachable (CI without Docker, devs
 * without Docker Desktop running). Skipping is decided inside `beforeAll`:
 * if `PostgreSqlContainer.start()` throws, the `dockerAvailable` flag
 * stays `false` and each test calls `ctx.skip()` instead of failing.
 *
 * Validates: Requirements 2.4, 11.4
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
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import {
    PostgreSqlContainer,
    type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";

import type { Database } from "@/db/client";
import { runMigrations } from "@/db/migrate";
import { listWithFilters } from "@/db/repositories/tickets.repo";
import type { SessionUser } from "@/types/domain";

// ---------------------------------------------------------------------------
// Suite-level state
// ---------------------------------------------------------------------------

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool | undefined;
let db: Database | undefined;

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
        await pool.query("SELECT 1");

        // Apply the production migrations (Drizzle + manual SQL). This is
        // the same path `pnpm db:migrate` exercises, so the schema seen by
        // `listWithFilters` here is identical to production.
        await runMigrations(pool, { log: () => undefined });

        // Cast is safe: `Database = typeof drizzle(pool)` for the same
        // node-postgres driver used in `src/db/client.ts`.
        db = drizzle(pool) as unknown as Database;

        // ---- Bootstrap minimal reference data ----------------------------
        // We bypass `seedIfEmpty` because (a) it inserts demo passwords
        // via bcrypt cost 12, which is wasteful for a property focused on
        // RBAC scoping, and (b) we need extra users (sol2) beyond the
        // default seed.
        const dept = await pool.query<{ id: string }>(
            `INSERT INTO departments (name) VALUES ('TI') RETURNING id`,
        );
        SEED.deptId = dept.rows[0]!.id;

        await pool.query(
            `INSERT INTO categories (id, label, sub, icon)
             VALUES ($1, 'Sistema', 'Sistemas internos', 'cog')`,
            [SEED.categoryId],
        );

        await pool.query(
            `INSERT INTO sla_policies (priority, minutes) VALUES
                ('baixa', 2880),
                ('media', 1440),
                ('alta', 480),
                ('critica', 120)`,
        );

        // The bcrypt hash is irrelevant for this suite — `password_hash`
        // is only required to be NOT NULL. Use a recognisable placeholder.
        const placeholderHash = "$2b$12$placeholder.placeholder.placeholder.placeholder.placeholder";

        const sol1 = await pool.query<{ id: string }>(
            `INSERT INTO users (email, password_hash, name, role, department_id)
             VALUES ($1, $2, 'Sol 1', 'solicitante', $3) RETURNING id`,
            ["sol1@navedesk.test", placeholderHash, SEED.deptId],
        );
        SEED.sol1Id = sol1.rows[0]!.id;

        const sol2 = await pool.query<{ id: string }>(
            `INSERT INTO users (email, password_hash, name, role, department_id)
             VALUES ($1, $2, 'Sol 2', 'solicitante', $3) RETURNING id`,
            ["sol2@navedesk.test", placeholderHash, SEED.deptId],
        );
        SEED.sol2Id = sol2.rows[0]!.id;

        const tec = await pool.query<{ id: string }>(
            `INSERT INTO users (email, password_hash, name, role, department_id)
             VALUES ($1, $2, 'Tec', 'tecnico', $3) RETURNING id`,
            ["tec@navedesk.test", placeholderHash, SEED.deptId],
        );
        SEED.tecId = tec.rows[0]!.id;

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
            `[tickets.requester-scope] Docker unavailable — skipping suite. Reason: ${reason}`,
        );
    }
}, 180_000);

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
 * Skips the test when Docker is unavailable. Returns the narrowed
 * `Database` and the three `SessionUser`s the test bodies need.
 */
function requireSetup(ctx: TestContext): {
    db: Database;
    sol1: SessionUser;
    sol2: SessionUser;
    tec: SessionUser;
} {
    if (!dockerAvailable || !db || !pool) {
        ctx.skip();
        throw new Error("unreachable: ctx.skip() throws");
    }
    return {
        db,
        sol1: {
            id: SEED.sol1Id,
            email: "sol1@navedesk.test",
            name: "Sol 1",
            role: "solicitante",
            departmentId: SEED.deptId,
        },
        sol2: {
            id: SEED.sol2Id,
            email: "sol2@navedesk.test",
            name: "Sol 2",
            role: "solicitante",
            departmentId: SEED.deptId,
        },
        tec: {
            id: SEED.tecId,
            email: "tec@navedesk.test",
            name: "Tec",
            role: "tecnico",
            departmentId: SEED.deptId,
        },
    };
}

/**
 * Removes every ticket and its dependents between property iterations.
 * `RESTART IDENTITY CASCADE` is harmless here (no IDENTITY columns in
 * scope) and keeps the tear-down terse.
 */
async function truncateTickets(): Promise<void> {
    await pool!.query(
        "TRUNCATE TABLE ticket_messages, ticket_events, attachments, tickets RESTART IDENTITY CASCADE",
    );
}

/** Status values exercised by the property — every value reachable on
 *  insert (no transitions are simulated here, so we exclude `fechado` and
 *  `resolvido` because their domain semantics demand a `closedAt` /
 *  `resolvedAt` and would distract from the property under test). */
type SeedStatus = "aberto" | "andamento" | "aguardando";

/** Priorities exercised by the property — the full enum. */
type SeedPriority = "baixa" | "media" | "alta" | "critica";

/**
 * Specification of a single ticket to insert. The arbitraries pick from a
 * tiny domain so each property iteration produces a wide variety of
 * (requester, assignee, status, priority) combinations without bloating
 * the SQL workload.
 */
interface TicketSpec {
    /** 0 → sol1, 1 → sol2. */
    requesterIdx: 0 | 1;
    /** -1 → unassigned, 0 → tec. */
    assigneeIdx: -1 | 0;
    status: SeedStatus;
    priority: SeedPriority;
}

const baseSpecArb: fc.Arbitrary<TicketSpec> = fc.record({
    requesterIdx: fc.constantFrom(0, 1) as fc.Arbitrary<0 | 1>,
    assigneeIdx: fc.constantFrom(-1, 0) as fc.Arbitrary<-1 | 0>,
    status: fc.constantFrom<SeedStatus>("aberto", "andamento", "aguardando"),
    priority: fc.constantFrom<SeedPriority>("baixa", "media", "alta", "critica"),
});

/**
 * Generates a batch of ticket specs guaranteed to contain at least one
 * sol1 ticket and one sol2 ticket. Without this guarantee the property
 * could hold vacuously when every random spec lands on a single
 * solicitante: the test would still pass but would not exercise the SQL
 * filter at all. Aim for ~20 tickets per iteration to give the random
 * distribution room to vary.
 */
const ticketsArb: fc.Arbitrary<TicketSpec[]> = fc
    .array(baseSpecArb, { minLength: 16, maxLength: 22 })
    .map((extras) => [
        // Forced anchors so every iteration covers both solicitantes.
        {
            requesterIdx: 0 as const,
            assigneeIdx: -1 as const,
            status: "aberto" as const,
            priority: "media" as const,
        },
        {
            requesterIdx: 1 as const,
            assigneeIdx: -1 as const,
            status: "aberto" as const,
            priority: "media" as const,
        },
        ...extras,
    ]);

/**
 * Inserts the specified tickets with deterministic identifiers and
 * staggered timestamps so the default `(updatedAt DESC, id DESC)` order
 * of `listWithFilters` is well-defined.
 */
async function insertTickets(specs: TicketSpec[]): Promise<void> {
    const baseTime = Date.UTC(2025, 0, 1);
    const oneHourMs = 3_600_000;

    for (let i = 0; i < specs.length; i++) {
        const spec = specs[i]!;
        const requesterId = spec.requesterIdx === 0 ? SEED.sol1Id : SEED.sol2Id;
        const assigneeId = spec.assigneeIdx === 0 ? SEED.tecId : null;
        const createdAt = new Date(baseTime + i * 60_000);
        const slaDeadline = new Date(baseTime + i * 60_000 + 24 * oneHourMs);

        await pool!.query(
            `INSERT INTO tickets
                (id, title, description, status, priority,
                 category_id, department_id, requester_id, assignee_id,
                 created_at, updated_at, sla_deadline)
             VALUES
                ($1, $2, $3, $4, $5,
                 $6, $7, $8, $9,
                 $10, $10, $11)`,
            [
                `NVD-${1000 + i}`,
                `Ticket ${i}`,
                "desc",
                spec.status,
                spec.priority,
                SEED.categoryId,
                SEED.deptId,
                requesterId,
                assigneeId,
                createdAt,
                slaDeadline,
            ],
        );
    }
}

// ---------------------------------------------------------------------------
// Property 10 — solicitante só vê os próprios tickets
// ---------------------------------------------------------------------------

describe("listWithFilters — Property 10: solicitante só vê os próprios tickets (R2.4, R11.4)", () => {
    it(
        "for any random distribution of tickets across two solicitantes, each only sees rows where requesterId matches their id",
        async (ctx) => {
            const { db: dbActive, sol1, sol2 } = requireSetup(ctx);

            // numRuns kept small because each iteration touches the DB:
            // truncate + INSERT × N + SELECT. 12 runs × ~20 tickets keeps
            // total wall time well under the integration budget while
            // still sampling enough distributions to catch a regression.
            // Each iteration asserts the property for BOTH solicitantes
            // so a leak in either direction shrinks to a counter-example.
            await fc.assert(
                fc.asyncProperty(ticketsArb, async (specs) => {
                    await truncateTickets();
                    await insertTickets(specs);

                    // We bump the limit so a single page covers the full
                    // fixture — the property is about scoping, not about
                    // pagination semantics (Property 11 covers that).
                    const sol1Page = await listWithFilters(dbActive, sol1, {
                        limit: 200,
                    });
                    const sol2Page = await listWithFilters(dbActive, sol2, {
                        limit: 200,
                    });

                    for (const ticket of sol1Page.rows) {
                        // Throwing inside the property body lets fast-check
                        // capture the failing example for shrinking. The
                        // expect message includes the offending ticket id
                        // so a regression is easy to triage.
                        expect(
                            ticket.requesterId,
                            `ticket ${ticket.id} leaked into sol1 view (requesterId=${ticket.requesterId})`,
                        ).toBe(sol1.id);
                    }
                    for (const ticket of sol2Page.rows) {
                        expect(
                            ticket.requesterId,
                            `ticket ${ticket.id} leaked into sol2 view (requesterId=${ticket.requesterId})`,
                        ).toBe(sol2.id);
                    }

                    // Sanity: the forced anchors guarantee at least one
                    // ticket per solicitante exists, so neither view can
                    // be vacuously empty. A vacuous pass would mean the
                    // test is not actually exercising the filter.
                    expect(sol1Page.rows.length).toBeGreaterThanOrEqual(1);
                    expect(sol2Page.rows.length).toBeGreaterThanOrEqual(1);

                    // Disjointness: the two views must not overlap on
                    // any ticket id. This catches a class of regressions
                    // where the implicit filter is dropped entirely
                    // (both views would include every ticket).
                    const sol1Ids = new Set(sol1Page.rows.map((t) => t.id));
                    for (const ticket of sol2Page.rows) {
                        expect(
                            sol1Ids.has(ticket.id),
                            `ticket ${ticket.id} appeared in both sol1 and sol2 views`,
                        ).toBe(false);
                    }
                }),
                { numRuns: 12 },
            );
        },
        120_000,
    );

    it(
        "filters.requesterId override is ignored for solicitante (sol1 cannot impersonate sol2 via filter)",
        async (ctx) => {
            const { db: dbActive, sol1, sol2 } = requireSetup(ctx);

            await truncateTickets();
            await insertTickets([
                {
                    requesterIdx: 0,
                    assigneeIdx: -1,
                    status: "aberto",
                    priority: "media",
                },
                {
                    requesterIdx: 1,
                    assigneeIdx: -1,
                    status: "aberto",
                    priority: "media",
                },
                {
                    requesterIdx: 1,
                    assigneeIdx: 0,
                    status: "andamento",
                    priority: "alta",
                },
            ]);

            // Crafted attack: the client sends `requesterId = sol2.id` to
            // try to read sol2's tickets. The SQL must override this with
            // `requester_id = sol1.id`.
            const page = await listWithFilters(dbActive, sol1, {
                requesterId: sol2.id,
            });

            for (const ticket of page.rows) {
                expect(ticket.requesterId).toBe(sol1.id);
            }
            // Sol1 owns exactly one ticket in this fixture; the override
            // attempt must not hide that row either.
            expect(page.rows).toHaveLength(1);
        },
        60_000,
    );

    it(
        "assigneeId='me' for solicitante still scopes by requesterId (no cross-requester leakage via assignee filter)",
        async (ctx) => {
            const { db: dbActive, sol1 } = requireSetup(ctx);

            await truncateTickets();
            // Note: solicitantes never appear in `assignee_id` (the schema
            // permits it, but the domain reserves assignment for tecnicos).
            // The point of the fixture is that even when both tickets share
            // the same assignee, the requester filter still applies.
            await insertTickets([
                {
                    requesterIdx: 0,
                    assigneeIdx: 0,
                    status: "andamento",
                    priority: "media",
                },
                {
                    requesterIdx: 1,
                    assigneeIdx: 0,
                    status: "andamento",
                    priority: "media",
                },
            ]);

            const page = await listWithFilters(dbActive, sol1, {
                assigneeId: "me",
            });

            for (const ticket of page.rows) {
                expect(ticket.requesterId).toBe(sol1.id);
            }
        },
        60_000,
    );

    it(
        "tecnico is not scoped by requesterId — sees tickets from every solicitante (sanity check on the property)",
        async (ctx) => {
            const { db: dbActive, tec } = requireSetup(ctx);

            await truncateTickets();
            await insertTickets([
                {
                    requesterIdx: 0,
                    assigneeIdx: -1,
                    status: "aberto",
                    priority: "media",
                },
                {
                    requesterIdx: 0,
                    assigneeIdx: 0,
                    status: "andamento",
                    priority: "alta",
                },
                {
                    requesterIdx: 1,
                    assigneeIdx: -1,
                    status: "aberto",
                    priority: "baixa",
                },
                {
                    requesterIdx: 1,
                    assigneeIdx: 0,
                    status: "aguardando",
                    priority: "critica",
                },
            ]);

            const page = await listWithFilters(dbActive, tec, { limit: 200 });

            // The sanity check: the implicit `requesterId = user.id`
            // restriction must NOT apply to tecnico, otherwise the
            // property under test would be trivially true for every
            // role and would not actually prove the RBAC scoping.
            const requesterIds = new Set(page.rows.map((t) => t.requesterId));
            expect(requesterIds.has(SEED.sol1Id)).toBe(true);
            expect(requesterIds.has(SEED.sol2Id)).toBe(true);
            expect(page.rows).toHaveLength(4);
        },
        60_000,
    );
});
