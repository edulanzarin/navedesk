-- Manual migration: tabela `notifications` + índices
--
-- Adiciona o sistema de notificações por usuário. Cada linha é dirigida
-- a um destinatário específico (`user_id`); os serviços de domínio
-- enfileiram aqui quando algo acontece em um ticket (criação, mudança
-- de estado, mensagem).
--
-- Por que SQL manual em vez de Drizzle generate?
-- O projeto já mistura Drizzle com SQL manual quando objetos
-- específicos (sequências, índices parciais, expressões custom) são
-- mais expressivos diretamente em SQL — ver `0001_ticket_seq.sql` e
-- `0003_sla_minutes.sql`. Aqui aproveitamos pra:
--   - criar o enum de tipos com sintaxe clara
--   - adicionar índice parcial em `read_at IS NULL` para acelerar o
--     badge de não-lidas (Drizzle não suporta WHERE em índice por enum
--     parcial diretamente)
--
-- Idempotência:
--   Tudo guardado por `IF NOT EXISTS` / `DO $$ ... $$`. Re-aplicar é
--   no-op.

-- 1) Enum de tipos
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_type') THEN
        CREATE TYPE notification_type AS ENUM (
            'ticket_created',
            'ticket_assigned',
            'ticket_unassigned',
            'ticket_status_changed',
            'ticket_priority_changed',
            'ticket_resolved',
            'ticket_closed',
            'message_public',
            'message_internal',
            'ticket_rated'
        );
    END IF;
END $$;

-- 2) Tabela
CREATE TABLE IF NOT EXISTS notifications (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ticket_id   text REFERENCES tickets(id) ON DELETE CASCADE,
    type        notification_type NOT NULL,
    title       text NOT NULL,
    body        text,
    actor_id    uuid REFERENCES users(id) ON DELETE SET NULL,
    read_at     timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- 3) Índices
-- Listagem paginada do usuário, mais recentes primeiro.
CREATE INDEX IF NOT EXISTS notifications_user_created_idx
    ON notifications (user_id, created_at DESC);

-- Badge de não-lidas (consultado a cada navegação). Índice parcial
-- mantém o tamanho enxuto: só inclui linhas onde `read_at IS NULL`.
CREATE INDEX IF NOT EXISTS notifications_unread_idx
    ON notifications (user_id)
    WHERE read_at IS NULL;
