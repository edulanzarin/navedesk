-- Manual migration: SLA policies — granularidade em minutos
--
-- Antes desta migration, `sla_policies.hours` era um inteiro >= 1 (horas).
-- A regra do produto evoluiu para permitir prazos sub-hora (ex.: 30 minutos
-- para prioridade `critica`), então a unidade muda para minutos.
--
-- Passos (tudo dentro de uma transação implícita do migrate runner):
--   1. ALTER COLUMN renomeia `hours` → `minutes` preservando os valores.
--   2. Multiplica os valores existentes por 60 (eram horas, agora são minutos).
--   3. Aplica os novos defaults do produto:
--        critica = 30 min     (0h 30min)
--        alta    = 60 min     (1h)
--        media   = 120 min    (2h)
--        baixa   = 180 min    (3h)
--
-- Idempotência:
--   O runner em `src/db/migrate.ts` registra cada arquivo aplicado em
--   `_applied_manual_migrations`, então execuções subsequentes são no-op.
--   Adicionalmente, o passo (1) usa `IF EXISTS` na coluna antiga e o passo
--   (2) é um UPDATE incondicional que só executa caso a coluna ainda não
--   tenha sido convertida — proteção redundante caso alguém tente
--   re-aplicar este SQL fora do runner.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'sla_policies'
          AND column_name = 'hours'
    ) THEN
        -- 1) Rename + 2) conversão horas → minutos
        ALTER TABLE sla_policies RENAME COLUMN hours TO minutes;
        UPDATE sla_policies SET minutes = minutes * 60;
    END IF;
END $$;

-- 3) Aplica os novos defaults pedidos pelo produto. Se o admin já tiver
--    customizado pela UI, esses valores serão sobrescritos uma única vez
--    nesta janela de migração — comportamento intencional, pois a unidade
--    base mudou e os valores antigos (em horas) ficaram fora da nova escala
--    desejada.
UPDATE sla_policies SET minutes = 30  WHERE priority = 'critica';
UPDATE sla_policies SET minutes = 60  WHERE priority = 'alta';
UPDATE sla_policies SET minutes = 120 WHERE priority = 'media';
UPDATE sla_policies SET minutes = 180 WHERE priority = 'baixa';
