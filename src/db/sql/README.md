# Manual SQL migrations

This directory holds SQL files that complement Drizzle's generated
migrations in `src/db/migrations/`.

## When to add a file here

Some database objects cannot be derived from `src/db/schema.ts` by
`drizzle-kit generate` — for example, sequences, custom GIN/GiST indexes
with non-trivial expressions, materialized views, or bespoke `tsvector`
configurations. Those go here as standalone `.sql` files.

## Conventions

- Filenames follow the `NNNN_short_name.sql` pattern (e.g.
  `0001_ticket_seq.sql`). The numeric prefix defines execution order.
- Every statement must be **idempotent**. Use `IF NOT EXISTS`,
  `CREATE OR REPLACE`, or guarded `DO $$ ... $$` blocks so that re-running
  the migrate runner against an already-up-to-date database is a safe
  no-op (R17.4).
- Begin each file with a header comment that:
  - links the change to the requirement(s) it validates;
  - explains why the object is not in the Drizzle schema;
  - notes any operational caveats.

## How they are applied

The `pnpm db:migrate` runner (`src/db/migrate.ts`, implemented in task
3.4) executes in two phases:

1. Run Drizzle's `migrate(db, { migrationsFolder: "src/db/migrations" })`
   to apply schema migrations generated from `src/db/schema.ts`.
2. Scan this directory in lexicographic order and execute each `.sql`
   file. The runner records applied filenames in a tracking table so that
   subsequent invocations skip files that have already run.

Files in this folder are versioned in Git alongside Drizzle's generated
migrations.
