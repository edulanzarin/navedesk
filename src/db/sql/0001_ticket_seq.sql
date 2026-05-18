-- Manual migration: ticket_seq sequence
--
-- Validates: R9.5 ("THE Gerador_ID SHALL usar `ticket_seq` iniciada em 1042
-- com incremento 1.")
--
-- This sequence backs `lib/ticket-id.ts::nextTicketId`, which calls
-- `SELECT nextval('ticket_seq')` to produce the numeric portion of ticket
-- identifiers in the `NVD-{n}` format (R9.1, R9.2).
--
-- The Drizzle schema in `src/db/schema.ts` does not declare this sequence
-- via `pgSequence`, so it cannot be produced by `drizzle-kit generate`.
-- Files in `src/db/sql/` are applied by the custom migrate runner
-- (`src/db/migrate.ts`, task 3.4) AFTER Drizzle's generated migrations,
-- in lexicographic order. The runner records each applied file so that
-- repeated executions are no-ops, and `IF NOT EXISTS` keeps the statement
-- itself idempotent at the database level (R17.4).

CREATE SEQUENCE IF NOT EXISTS ticket_seq
    START WITH 1042
    INCREMENT BY 1;
