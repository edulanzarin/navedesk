# syntax=docker/dockerfile:1.7
# =============================================================================
# NaveDesk — Dockerfile multi-stage para Next.js 15 com saída "standalone".
#
# Estágios:
#   1. deps     -> instala dependências com pnpm + corepack (cache friendly)
#   2. builder  -> compila o app (`pnpm build`) e gera `.next/standalone`
#   3. runner   -> imagem final mínima; expõe :3000 e roda `node server.js`
#
# Validates: R18.9 (multi-stage `deps`/`builder`/`runner`, base `node:20-alpine`,
#            saída standalone).
# =============================================================================


# -----------------------------------------------------------------------------
# Estágio 1: deps
# Instala todas as dependências a partir do lockfile com pnpm via corepack.
# Mantém este estágio focado apenas em manifests para maximizar o cache do
# Docker entre builds quando o código muda mas as deps não.
# -----------------------------------------------------------------------------
FROM node:20-alpine AS deps

# libc6-compat é necessário para alguns binários nativos (sharp, etc.) em Alpine.
RUN apk add --no-cache libc6-compat

WORKDIR /app

# Habilita corepack (pnpm) — versão pinada via campo `packageManager`/lockfile.
RUN corepack enable

# Copia somente manifests para aproveitar o cache de camadas.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# `--frozen-lockfile` garante reprodutibilidade: falha se o lockfile divergir.
RUN pnpm install --frozen-lockfile


# -----------------------------------------------------------------------------
# Estágio 2: builder
# Copia o código + node_modules e executa `pnpm build`. O Next.js, com
# `output: "standalone"` em `next.config.ts`, gera `.next/standalone` contendo
# `server.js` e um `node_modules` mínimo otimizado.
# -----------------------------------------------------------------------------
FROM node:20-alpine AS builder

RUN apk add --no-cache libc6-compat
WORKDIR /app

RUN corepack enable

# Aproveita node_modules já instalado no estágio `deps`.
COPY --from=deps /app/node_modules ./node_modules

# Copia o restante do projeto. `.dockerignore` cuida de excluir testes, .git,
# .next pré-existente, etc.
COPY . .

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN pnpm build


# -----------------------------------------------------------------------------
# Estágio 3: runner
# Imagem final enxuta. Mantém pnpm disponível (via corepack) para que o
# entrypoint do compose possa rodar `pnpm db:migrate` e
# `pnpm db:seed:if-empty` antes de iniciar o servidor.
# -----------------------------------------------------------------------------
FROM node:20-alpine AS runner

RUN apk add --no-cache libc6-compat
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=4001
ENV HOSTNAME=0.0.0.0

# pnpm também precisa estar disponível em runtime para os scripts de migrate/seed.
RUN corepack enable

# Usuário não-root para o runtime.
RUN addgroup --system --gid 1001 nodejs \
    && adduser  --system --uid 1001 --ingroup nodejs nextjs

# 1) Saída standalone do Next.js: traz `server.js` + node_modules mínimo + manifests.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./

# 2) Sobrescreve o node_modules mínimo do standalone com o conjunto completo
#    instalado no estágio deps. Necessário para que `pnpm db:migrate` e
#    `pnpm db:seed:if-empty` consigam resolver pacotes como `drizzle-orm`, `pg`
#    e o runner TypeScript (a serem adicionados nas tasks 2.5/3.x).
COPY --from=deps    --chown=nextjs:nodejs /app/node_modules     ./node_modules

# 3) Assets estáticos do Next.js (chunks, imagens otimizadas).
COPY --from=builder --chown=nextjs:nodejs /app/.next/static     ./.next/static

# 4) Pasta `public` (inclui o ponto de montagem `public/uploads`, sobreposto
#    pelo volume do docker-compose em runtime).
COPY --from=builder --chown=nextjs:nodejs /app/public           ./public

# 5) Lockfile + workspace para que `pnpm` em runtime use exatamente as mesmas
#    versões resolvidas no estágio deps.
COPY --from=builder --chown=nextjs:nodejs /app/pnpm-lock.yaml   ./pnpm-lock.yaml
COPY --from=builder --chown=nextjs:nodejs /app/pnpm-workspace.yaml ./pnpm-workspace.yaml

# 6) Drizzle: schema, migrate.ts, seed.ts e migrations geradas.
#    A pasta de migrations vive em `src/db/migrations` (per drizzle.config.ts,
#    a ser criado na task 2.5). `tsconfig.json` é necessário para resolver
#    paths `@/*` quando os scripts forem executados via tsx/ts-node.
COPY --from=builder --chown=nextjs:nodejs /app/src/db           ./src/db
COPY --from=builder --chown=nextjs:nodejs /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder --chown=nextjs:nodejs /app/tsconfig.json     ./tsconfig.json

USER nextjs

EXPOSE 4001

# `server.js` é o entrypoint produzido pelo Next.js standalone.
# O docker-compose pode sobrescrever este CMD para rodar migrations + seed antes:
#   command: sh -c "pnpm db:migrate && pnpm db:seed:if-empty && node server.js"
CMD ["node", "server.js"]
