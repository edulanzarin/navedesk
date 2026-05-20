-- Manual migration: full-text search em tickets.
--
-- Adiciona um índice GIN sobre `to_tsvector('portuguese', title || ' ' || description)`
-- para que `WHERE search_vec @@ to_tsquery(...)` seja O(log N) em vez de full
-- table scan com `ILIKE`. A configuração `portuguese` aplica stemming
-- adequado ao idioma (busca por "vpn" também casa com "VPNs", "configurar"
-- casa com "configuração", etc.).
--
-- Por que não uma coluna tsvector materializada?
-- Em Postgres 12+, índices GIN sobre expressões funcionam tão bem quanto
-- colunas materializadas para casos de uso simples como este. Evita
-- precisar manter trigger de UPDATE e mais uma coluna a copiar em cada
-- mutação. Se o volume crescer muito, dá pra refatorar pra coluna +
-- trigger sem alterar o código que consulta (basta trocar o índice).
--
-- Idempotência: `CREATE INDEX IF NOT EXISTS` cobre re-execução.

CREATE INDEX IF NOT EXISTS tickets_search_idx
    ON tickets
    USING GIN (
        to_tsvector(
            'portuguese',
            coalesce(title, '') || ' ' || coalesce(description, '')
        )
    );

-- Adicionalmente, extensão pg_trgm para fallback de busca por substring
-- (útil para correspondências parciais que o tsvector ignora — ex.: o
-- usuário digita "VPN" e queremos casar com "VPN-CORP" mesmo sem o
-- stemmer entender). pg_trgm vem com Postgres por padrão a partir da
-- 9.1; ativar é seguro mesmo se já estiver presente.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Índice GIN trigrama em title pra busca por substring rápida quando
-- o usuário busca strings que não passam pelo stemmer (ex.: códigos,
-- nomes próprios curtos). Permanece pequeno por ser só em `title`.
CREATE INDEX IF NOT EXISTS tickets_title_trgm_idx
    ON tickets
    USING GIN (title gin_trgm_ops);
