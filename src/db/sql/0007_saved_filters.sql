-- Manual migration: filtros salvos por usuário.
--
-- Cada técnico/admin/solicitante pode salvar combinações de filtros da
-- listagem de tickets (`/tickets?status=...&assignee=me&...`) com um
-- nome legível ("Meus em andamento", "Críticos sem responsável") e
-- aplicá-las com um clique.
--
-- `query_string` guarda o suffix da URL (sem o `?` inicial). A
-- interpretação mora no caller — esta tabela é apenas chave-valor por
-- usuário.

CREATE TABLE IF NOT EXISTS saved_filters (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name          text NOT NULL,
    query_string  text NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS saved_filters_user_idx
    ON saved_filters (user_id, created_at DESC);
