-- Manual migration: tabela `sla_alerts`.
--
-- Registra quais tickets já foram alertados em cada nível de SLA
-- (warn = 50% do prazo decorrido sem resposta; breached = vencido).
-- Sem essa tabela, o cron de escalonamento dispararia alertas
-- repetidos a cada execução enquanto o ticket continuasse no nível.
--
-- Uma linha por (ticket, nível). UNIQUE garante idempotência —
-- INSERT ... ON CONFLICT DO NOTHING vira no-op para níveis já
-- alertados.
--
-- Idempotência: `IF NOT EXISTS`.

CREATE TABLE IF NOT EXISTS sla_alerts (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id   text NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    level       text NOT NULL CHECK (level IN ('warn', 'breached')),
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (ticket_id, level)
);

CREATE INDEX IF NOT EXISTS sla_alerts_ticket_idx
    ON sla_alerts (ticket_id);
