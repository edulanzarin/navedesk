-- Adiciona o campo `avatar_url` à tabela `users`.
--
-- Permite que cada usuário envie uma foto de perfil opcional via
-- `/perfil`. Quando `null`, a UI cai no avatar de iniciais sobre a
-- cor `avatar_color`. A URL aponta para `/api/uploads/{id}` — o
-- mesmo handler usado por anexos de tickets, com RBAC e validação
-- de magic bytes.
--
-- A coluna é nullable (sem default) para que usuários existentes
-- continuem com avatar de iniciais até definirem uma foto manualmente.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS avatar_url text;
