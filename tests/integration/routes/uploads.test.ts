/**
 * Integration test — Route handlers `POST /api/uploads` and
 * `GET /api/uploads/[id]` against an ephemeral PostgreSQL container.
 *
 * Validates: R8.2, R8.3, R8.4, R8.7, R22.4, R22.6.
 *
 * Scenarios
 *   1. Upload too large (>25 MiB)         → 413 `TOO_LARGE`           (R8.3, R22.4).
 *   2. Upload with un-allowlisted MIME    → 415 `UNSUPPORTED_MIME`    (R8.2, R22.4).
 *   3. Upload with magic-byte mismatch    → 415 `MIME_MISMATCH`       (R8.4, R22.4).
 *   4. Upload happy path (valid PNG)      → 201 + persisted row.
 *   5. Download own attachment            → 200 + Content-Disposition (R8.8).
 *   6. Download foreign attachment        → 404 sem corpo             (R8.7, R22.6).
 *
 * Why integration — the route handlers compose `auth()`, `file-type` magic
 * byte detection, `LocalDiskStorage` filesystem writes and Drizzle inserts
 * against `attachments`. Substituting any of those with a stub would let
 * regressions slip through (e.g. a wrong `WHERE` in `findById`, a path
 * traversal in storage, a relaxed allowlist). We mock only `auth()` —
 * the smallest seam that lets us drive the handler without spinning up
 * Next.js and a real session cookie. Every other dependency is real.
 *
 * Container lifecycle — Postgres is provisioned via `@testcontainers/postgresql`
 * and torn down in `afterAll`. When Docker is unavailable (CI without
 * docker, sandboxed dev box) the suite skips gracefully via `describe.skipIf`
 * instead of failing.
 *
 * Note on imports — the route modules transitively import `@/db/client`,
 * which throws at module load time if `DATABASE_URL` is unset. We therefore
 * set `DATABASE_URL` (and `UPLOAD_DIR`) inside `beforeAll`, then pull the
 * route handlers in via dynamic `await import(...)`. The same trick is used
 * by `tests/integration/services/messages.conservation.test.ts`.
 */

import { execSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

import bcrypt from "bcrypt";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import {
    afterAll,
    beforeAll,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import {
    PostgreSqlContainer,
    type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";

import { runMigrations } from "@/db/migrate";
import {
    attachments,
    categories,
    departments,
    slaPolicies,
    tickets,
    users,
} from "@/db/schema";
import type { SessionUser } from "@/types/domain";

// ---------------------------------------------------------------------------
// auth() mock — hoisted so the route module sees it on first import.
// ---------------------------------------------------------------------------

/**
 * Mutable session reference. Tests overwrite `currentSession` to switch the
 * caller without re-importing the route. The `auth` mock simply returns
 * whatever `currentSession` currently points to, mirroring how Auth.js
 * resolves the session per request in production.
 */
let currentSession: { user: SessionUser } | null = null;

vi.mock("@/lib/auth", () => ({
    // Deliberately a function, not an arrow, so the mock can be inspected
    // via `mockClear()` if a future test needs to assert call counts.
    auth: vi.fn(async () => currentSession),
}));

// ---------------------------------------------------------------------------
// Docker availability — skip the suite if Docker is unreachable.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Test fixtures: pre-built buffers for each scenario.
// ---------------------------------------------------------------------------

/**
 * Minimal valid 1x1 transparent PNG. The first 8 bytes are the PNG
 * signature (`89 50 4E 47 0D 0A 1A 0A`); `file-type` keys off this magic
 * to report `image/png`. Using a fully-formed PNG (with IHDR/IDAT/IEND
 * chunks) guards against future versions of `file-type` requiring more
 * than the bare signature for confirmation.
 */
const PNG_BYTES = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // signature
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR len + tag
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, // bit depth/etc + CRC
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, // IDAT
    0x78, 0x9c, 0x62, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4,
    0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82, // IEND + CRC
]);

const UPLOAD_MAX_BYTES = 25 * 1024 * 1024;

const PLACEHOLDER_HASH_FALLBACK =
    "$2b$12$placeholder.placeholder.placeholder.placeholder.placeholder";

// ---------------------------------------------------------------------------
// Suite-level state populated in beforeAll.
// ---------------------------------------------------------------------------

interface RouteModules {
    POST: (req: Request) => Promise<Response>;
    GET: (
        req: Request,
        ctx: { params: Promise<{ id: string }> },
    ) => Promise<Response>;
}

interface SeedIds {
    deptId: string;
    solicitante1: SessionUser;
    solicitante2: SessionUser;
    /** Ticket owned by `solicitante1` — used for RBAC negative test. */
    ticketId: string;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe.skipIf(!dockerAvailable)(
    "uploads route handlers (Testcontainers)",
    () => {
        let container: StartedPostgreSqlContainer;
        let pool: Pool;
        let db: ReturnType<typeof drizzle>;
        let uploadsDir: string;
        let routes: RouteModules;
        let seed: SeedIds;
        /** Pool opened internally by `@/db/client` — must be closed in afterAll. */
        let internalPool: Pool | undefined;

        beforeAll(async () => {
            // 1) Start Postgres.
            container = await new PostgreSqlContainer("postgres:16-alpine")
                .withDatabase("navedesk_test")
                .withUsername("test")
                .withPassword("test")
                .start();

            const connectionString = container.getConnectionUri();

            // 2) Wire env BEFORE importing anything that touches `@/db/client`.
            //    `UPLOAD_DIR` points at a per-suite tempdir so the route's
            //    `LocalDiskStorage` writes never touch the real `public/uploads`.
            process.env.DATABASE_URL = connectionString;
            uploadsDir = await mkdtemp(
                path.join(tmpdir(), "navedesk-uploads-"),
            );
            process.env.UPLOAD_DIR = uploadsDir;

            pool = new Pool({
                connectionString,
                max: 4,
                connectionTimeoutMillis: 10_000,
            });
            db = drizzle(pool);

            await runMigrations(pool, { log: () => undefined });

            // 3) Minimal seed: 1 dept, 1 category, 4 SLA policies, 2
            //    solicitantes, 1 ticket owned by solicitante1.
            const [department] = await db
                .insert(departments)
                .values({ name: "TI" })
                .returning({ id: departments.id });
            if (!department) throw new Error("seed: department insert failed");

            await db.insert(categories).values({
                id: "sistema",
                label: "Sistema",
                sub: "Sistemas internos",
                icon: "cog",
            });

            await db.insert(slaPolicies).values([
                { priority: "baixa", hours: 48 },
                { priority: "media", hours: 24 },
                { priority: "alta", hours: 8 },
                { priority: "critica", hours: 2 },
            ]);

            // bcrypt cost is irrelevant for this suite (auth is mocked) —
            // a placeholder hash satisfies the NOT NULL column without
            // burning CPU on a real round.
            const placeholder = PLACEHOLDER_HASH_FALLBACK;
            // But hash one real password so a future test can call the real
            // `verifyPassword` path without changing the seed.
            await bcrypt.hash("placeholder", 4); // warm-up; result discarded.

            const [sol1, sol2] = await db
                .insert(users)
                .values([
                    {
                        email: "sol1@navedesk.test",
                        name: "Solicitante 1",
                        role: "solicitante",
                        passwordHash: placeholder,
                        departmentId: department.id,
                        active: true,
                    },
                    {
                        email: "sol2@navedesk.test",
                        name: "Solicitante 2",
                        role: "solicitante",
                        passwordHash: placeholder,
                        departmentId: department.id,
                        active: true,
                    },
                ])
                .returning({ id: users.id });

            if (!sol1 || !sol2) throw new Error("seed: users insert failed");

            const ticketId = "NVD-1042";
            await db.insert(tickets).values({
                id: ticketId,
                title: "Ticket de teste para anexos",
                description:
                    "Ticket usado para validar o RBAC de download de anexos.",
                status: "andamento",
                priority: "media",
                categoryId: "sistema",
                departmentId: department.id,
                requesterId: sol1.id,
                slaDeadline: new Date(Date.UTC(2099, 0, 1)),
            });

            seed = {
                deptId: department.id,
                solicitante1: {
                    id: sol1.id,
                    email: "sol1@navedesk.test",
                    name: "Solicitante 1",
                    role: "solicitante",
                    departmentId: department.id,
                },
                solicitante2: {
                    id: sol2.id,
                    email: "sol2@navedesk.test",
                    name: "Solicitante 2",
                    role: "solicitante",
                    departmentId: department.id,
                },
                ticketId,
            };

            // 4) Dynamic import — DATABASE_URL is now set, so the
            //    module-level guard in `@/db/client` accepts the load.
            const postMod = await import("@/app/api/uploads/route");
            const getMod = await import("@/app/api/uploads/[id]/route");
            routes = {
                POST: postMod.POST as unknown as RouteModules["POST"],
                GET: getMod.GET as unknown as RouteModules["GET"],
            };

            // Capture the internal pool opened by `@/db/client` so we can
            // close it before the container stops (avoids the lingering
            // 57P01 notice on container teardown).
            const clientMod = await import("@/db/client");
            internalPool = clientMod.pool;
        }, 180_000);

        afterAll(async () => {
            await internalPool?.end().catch(() => undefined);
            await pool?.end().catch(() => undefined);
            await container?.stop().catch(() => undefined);
            if (uploadsDir) {
                await rm(uploadsDir, { recursive: true, force: true }).catch(
                    () => undefined,
                );
            }
        }, 60_000);

        // ---------------------------------------------------------------
        // Helpers — kept inside the describe to capture `routes` cleanly.
        // ---------------------------------------------------------------

        /** Switch the mocked session to `user` (or to `null` for anonymous). */
        function loginAs(user: SessionUser | null): void {
            currentSession = user ? { user } : null;
        }

        /**
         * Builds a `multipart/form-data` POST request to `/api/uploads`.
         *
         * Uses the WHATWG `Request` constructor with a `FormData` body —
         * undici (Node 20) sets the boundary in `Content-Type` automatically,
         * which is exactly what `req.formData()` expects on the server side.
         */
        function buildUploadRequest(file: File): Request {
            const fd = new FormData();
            fd.append("file", file);
            return new Request("http://localhost/api/uploads", {
                method: "POST",
                body: fd,
            });
        }

        // ---------------------------------------------------------------
        // 1) Size limit — R8.3 / R22.4
        // ---------------------------------------------------------------

        it("rejects uploads larger than 25 MiB with 413 TOO_LARGE (R8.3, R22.4)", async () => {
            loginAs(seed.solicitante1);

            // Build a buffer one byte over the limit. We use `Buffer.alloc`
            // (not `randomBytes`) — the route checks size before reading
            // bytes, so the content is irrelevant.
            const oversized = Buffer.alloc(UPLOAD_MAX_BYTES + 1, 0);
            const file = new File([oversized], "huge.png", {
                type: "image/png",
            });

            const res = await routes.POST(buildUploadRequest(file));
            expect(res.status).toBe(413);

            const body = (await res.json()) as { code: string; message: string };
            expect(body.code).toBe("TOO_LARGE");
            // pt-BR mention of the limit (R22.4).
            expect(body.message).toMatch(/25\s?MiB/);
        });

        // ---------------------------------------------------------------
        // 2) Unsupported MIME — R8.2 / R22.4
        // ---------------------------------------------------------------

        it("rejects MIME types outside the allowlist with 415 UNSUPPORTED_MIME (R8.2, R22.4)", async () => {
            loginAs(seed.solicitante1);

            // `application/x-evil` is not on the allowlist, regardless of
            // any magic-byte detection that might happen later.
            const file = new File([Buffer.from("rogue payload")], "evil.bin", {
                type: "application/x-evil",
            });

            const res = await routes.POST(buildUploadRequest(file));
            expect(res.status).toBe(415);

            const body = (await res.json()) as { code: string; message: string };
            expect(body.code).toBe("UNSUPPORTED_MIME");
        });

        // ---------------------------------------------------------------
        // 3) Magic byte mismatch — R8.4 / R22.4
        // ---------------------------------------------------------------

        it("rejects files whose magic bytes don't match the declared MIME with 415 MIME_MISMATCH (R8.4, R22.4)", async () => {
            loginAs(seed.solicitante1);

            // PNG bytes declared as JPEG — the cheap allowlist check passes
            // (`image/jpeg` is allowed), but `file-type` reports `image/png`
            // so the route rejects on mismatch.
            const file = new File([PNG_BYTES], "fake.jpg", {
                type: "image/jpeg",
            });

            const res = await routes.POST(buildUploadRequest(file));
            expect(res.status).toBe(415);

            const body = (await res.json()) as { code: string; message: string };
            expect(body.code).toBe("MIME_MISMATCH");
        });

        // ---------------------------------------------------------------
        // 4) Happy path — valid PNG persists to DB and disk.
        // ---------------------------------------------------------------

        it("accepts a valid PNG, persists the row in `attachments` and stores the bytes", async () => {
            loginAs(seed.solicitante1);

            const file = new File([PNG_BYTES], "logo.png", {
                type: "image/png",
            });

            const res = await routes.POST(buildUploadRequest(file));
            expect(res.status).toBe(201);

            const body = (await res.json()) as {
                id: string;
                url: string;
                name: string;
                size: number;
                mime: string;
            };
            expect(body.mime).toBe("image/png");
            expect(body.size).toBe(PNG_BYTES.byteLength);
            expect(body.name).toBe("logo.png");
            expect(body.url).toBe(`/api/uploads/${body.id}`);

            // Cross-check against Drizzle: the row exists, belongs to
            // solicitante1 and has a sane storage key.
            const rows = await db.select().from(attachments);
            const inserted = rows.find((row) => row.id === body.id);
            expect(inserted).toBeDefined();
            expect(inserted!.uploaderId).toBe(seed.solicitante1.id);
            expect(inserted!.storageKey).toMatch(/^\d{4}\/\d{2}\/.+\.png$/);
            // ticketId is null until linked by the ticket creation flow.
            expect(inserted!.ticketId).toBeNull();
        });

        // ---------------------------------------------------------------
        // 5/6) Download — RBAC and headers.
        // ---------------------------------------------------------------

        it("returns the bytes to the uploader and 404 to a foreign user (R8.7, R22.6)", async () => {
            // Seed an attachment that's already linked to solicitante1's
            // ticket (mirrors the post-ticket-creation state). We insert
            // the bytes through the storage helper — same path the POST
            // handler uses — so the GET handler reads from a real file.
            const { createStorageFromEnv } = await import("@/lib/storage");
            const storage = createStorageFromEnv();
            const { key } = await storage.put(PNG_BYTES, { ext: "png" });

            const [att] = await db
                .insert(attachments)
                .values({
                    uploaderId: seed.solicitante1.id,
                    name: "comprovante.png",
                    mime: "image/png",
                    sizeBytes: PNG_BYTES.byteLength,
                    storageKey: key,
                    ticketId: seed.ticketId,
                })
                .returning({ id: attachments.id });
            if (!att) throw new Error("seed: attachment insert failed");

            // ---- Owner reads successfully (200 + correct headers). ----
            loginAs(seed.solicitante1);
            const ownerRes = await routes.GET(
                new Request(`http://localhost/api/uploads/${att.id}`),
                { params: Promise.resolve({ id: att.id }) },
            );
            expect(ownerRes.status).toBe(200);
            expect(ownerRes.headers.get("Content-Type")).toBe("image/png");
            expect(ownerRes.headers.get("Content-Length")).toBe(
                String(PNG_BYTES.byteLength),
            );
            // Image MIME → no `Content-Disposition: attachment` (inline).
            expect(ownerRes.headers.get("Content-Disposition")).toBeNull();

            const ownerBody = Buffer.from(await ownerRes.arrayBuffer());
            expect(ownerBody.equals(PNG_BYTES)).toBe(true);

            // ---- Foreign solicitante is denied as 404 (no body). ------
            //      We don't return 403: that would leak existence (R8.7).
            loginAs(seed.solicitante2);
            const foreignRes = await routes.GET(
                new Request(`http://localhost/api/uploads/${att.id}`),
                { params: Promise.resolve({ id: att.id }) },
            );
            expect(foreignRes.status).toBe(404);
            // Body must be empty — any payload could be a side channel.
            expect(await foreignRes.text()).toBe("");
        });

        // ---------------------------------------------------------------
        // Bonus: non-image attachments force `Content-Disposition: attachment`
        // (R8.8). Cheap to run while the suite is hot.
        // ---------------------------------------------------------------

        it("forces Content-Disposition: attachment for non-image downloads (R8.8)", async () => {
            const { createStorageFromEnv } = await import("@/lib/storage");
            const storage = createStorageFromEnv();
            const txtBytes = Buffer.from("conteúdo de log\n", "utf8");
            const { key } = await storage.put(txtBytes, { ext: "log" });

            const [att] = await db
                .insert(attachments)
                .values({
                    uploaderId: seed.solicitante1.id,
                    name: "registro.log",
                    mime: "text/x-log",
                    sizeBytes: txtBytes.byteLength,
                    storageKey: key,
                    ticketId: seed.ticketId,
                })
                .returning({ id: attachments.id });
            if (!att) throw new Error("seed: log attachment insert failed");

            loginAs(seed.solicitante1);
            const res = await routes.GET(
                new Request(`http://localhost/api/uploads/${att.id}`),
                { params: Promise.resolve({ id: att.id }) },
            );
            expect(res.status).toBe(200);
            const cd = res.headers.get("Content-Disposition");
            expect(cd).not.toBeNull();
            // Must contain both the ASCII fallback and RFC 5987 form.
            expect(cd!).toMatch(/attachment;\s*filename="registro.log"/);
            expect(cd!).toMatch(/filename\*=UTF-8''registro\.log/);
        });
    },
);

describe.skipIf(dockerAvailable)(
    "uploads route handlers (Testcontainers) — Docker unavailable",
    () => {
        it.skip("requires Docker to run; skipped because docker is not available", () => {
            /* Docker not detected; the real suite above is skipped. */
        });
    },
);
