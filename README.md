# Navedesk

Central interna de chamados (helpdesk) da Navecon. Solicitantes abrem tickets, técnicos atendem respeitando SLA por prioridade, e administradores configuram usuários, políticas e categorias. Tudo em pt-BR, com identidade visual índigo `#5E5CE6` e tipografia Geist.

## Stack

- **Next.js 15** (App Router, Server Components, Server Actions) + **TypeScript estrito**
- **PostgreSQL 16** + **Drizzle ORM** (migrations versionadas, sequência `ticket_seq` para IDs `NVD-XXXX`)
- **Auth.js v5** (Credentials provider, JWT em cookie HttpOnly)
- **Tailwind v4** + tokens CSS + `class-variance-authority`
- **Zod** para validação na borda
- **Docker Compose** orquestrando app + banco com migrations e seed idempotente no boot

---

## Subir o sistema (deploy completo)

A forma recomendada é via **Docker Compose**: empacota app, banco, migrations e seed numa sequência reproduzível em qualquer máquina (Windows, Linux, macOS).

### Pré-requisitos

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Windows/macOS) ou Docker Engine + Compose v2 (Linux)
- Aproximadamente 2 GB de RAM livres

### Passo a passo

```bash
# 1. Pegue o código
git clone <url-do-repo> navedesk
cd navedesk

# 2. Configure o .env (copia o template e ajusta)
cp .env.example .env

# 3. Gere um AUTH_SECRET único (uma vez por instalação)
#    Linux/macOS:
openssl rand -base64 32
#    Windows PowerShell:
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# Cole o valor em AUTH_SECRET dentro do .env

# 4. Sobe tudo (build da imagem + Postgres + migrations + seed + servidor)
docker compose up --build -d
```

Pronto. O app fica disponível em **`http://<ip-do-servidor>:4001`**.

- Local na máquina: `http://localhost:4001`
- Outras máquinas da rede: `http://<ip-do-pc>:4001` (ex.: `http://192.168.1.50:4001`)

> O Docker já publica a porta `4001` em `0.0.0.0`, ou seja, qualquer máquina que enxergar o IP do host na rede consegue acessar. Verifique o **firewall do Windows** se ninguém da LAN conseguir abrir.

### Descobrir o IP do servidor

| Sistema     | Comando                                                |
| ----------- | ------------------------------------------------------ |
| Windows     | `ipconfig` → procure "Endereço IPv4" da rede ativa     |
| Linux/macOS | `ip addr` ou `ifconfig`                                |

Depois de saber o IP (ex.: `192.168.1.50`), atualize a chave **`AUTH_URL`** no `.env` para `http://192.168.1.50:4001` e reinicie:

```bash
docker compose restart app
```

Sem isso o Auth.js pode rejeitar o cookie quando o usuário acessa pelo IP em vez de `localhost`.

### Comandos do dia a dia

```bash
# Status dos serviços
docker compose ps

# Logs em tempo real
docker compose logs -f app
docker compose logs -f db

# Parar (mantém os dados)
docker compose stop

# Iniciar de novo
docker compose start

# Derrubar tudo (mantém os volumes/dados)
docker compose down

# Derrubar e APAGAR os dados (cuidado!)
docker compose down -v
```

### Backup do banco

Os dados ficam no volume `pgdata`. Para gerar um dump:

```bash
docker compose exec db pg_dump -U $POSTGRES_USER $POSTGRES_DB > backup_$(date +%Y%m%d).sql
```

Para restaurar em uma instalação nova:

```bash
docker compose exec -T db psql -U $POSTGRES_USER $POSTGRES_DB < backup_20260101.sql
```

---

## Atualizações futuras

O fluxo é simples: puxa o código novo, rebuilda a imagem, sobe de novo. Migrations pendentes são aplicadas automaticamente no boot (idempotente).

```bash
# 1. Atualiza o código
git pull

# 2. Rebuilda a imagem do app e reinicia (mantém o banco)
docker compose up --build -d

# 3. Confirma que ficou tudo de pé
docker compose logs -f app
```

Se a atualização tiver migration nova, ela aparece no log como:

```
[db:migrate] applying Drizzle migrations from src/db/migrations
[db:migrate] applied manual migration: 0003_xxx.sql
```

> O `docker compose up --build -d` só recria os containers que mudaram. Postgres e os volumes ficam intactos.

### Em caso de problema com migration

```bash
# Roda só o migrate manualmente (útil pra ver o erro detalhado)
docker compose exec app pnpm db:migrate

# Roda o seed manualmente (só popula se a tabela `users` estiver vazia)
docker compose exec app pnpm db:seed:if-empty
```

---

## Disponibilizar pra rede (firewall do Windows)

O Docker já bind a porta em `0.0.0.0`, mas o firewall do Windows costuma bloquear conexões externas. Pra liberar:

1. Abrir **Firewall do Windows com Segurança Avançada**.
2. **Regras de Entrada → Nova Regra → Porta**.
3. **TCP**, porta específica `4001`.
4. **Permitir conexão**.
5. Aplica em **Domínio** e **Privada** (não habilite em Pública).
6. Nome: `Navedesk 4001`.

Para limitar quem pode acessar, edite a regra → aba **Escopo** → "Endereços IP remotos" → adicione apenas a faixa da LAN (ex.: `192.168.1.0/24`).

---

## Credenciais padrão do seed

O seed cria três usuários de exemplo, todos com senha `admin123`. **Troque-as** depois do primeiro login:

| Papel        | E-mail                                  |
| ------------ | --------------------------------------- |
| Admin        | `admin@navedesk.com`                    |
| Técnico      | `eduardo.lanzarin@navecon.net.br`       |
| Solicitante  | `teste@navecon.net.br`                  |

> Se você usou o `scripts/seed-custom.ts`, as credenciais podem ser outras (`Edz#7284@` para admin/técnico, `teste123` para solicitantes). Veja o que está no script.

---

## Variáveis de ambiente

Documentado em `.env.example`. Resumo das chaves:

- `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` — credenciais do banco no Compose.
- `DATABASE_URL` — string de conexão. No Compose: `postgres://user:pass@db:5432/db`. Local sem Docker: `localhost`.
- `DATABASE_POOL_MAX` — tamanho do pool (default `10`).
- `AUTH_SECRET` — segredo do Auth.js. **Obrigatório**, gere com `openssl rand -base64 32`.
- `AUTH_URL` — URL pública do app. Em LAN: `http://<ip-do-pc>:4001`.
- `UPLOAD_DIR` — onde anexos são salvos dentro do container (default `/app/public/uploads`, persistido no volume `uploads`).
- `UPLOAD_MAX_BYTES` — limite por arquivo (default 25 MiB).

`.env` está no `.gitignore` — nunca comite credenciais reais.

---

## Desenvolvimento local (sem Docker)

Pré-requisitos: **Node.js 20+**, **pnpm 9+** (`corepack enable`) e um **PostgreSQL 16** acessível.

```bash
pnpm install
cp .env.example .env          # ajuste DATABASE_URL para apontar ao seu Postgres local
pnpm db:migrate
pnpm db:seed:if-empty
pnpm dev                      # http://localhost:3000
```

### Scripts úteis

| Comando                   | Propósito                                                  |
| ------------------------- | ---------------------------------------------------------- |
| `pnpm dev`                | Servidor Next.js em modo desenvolvimento                   |
| `pnpm build`              | Build de produção (`output: standalone`)                   |
| `pnpm start`              | Servidor Next.js em modo produção                          |
| `pnpm lint`               | ESLint                                                     |
| `pnpm typecheck`          | Verificação de tipos TypeScript                            |
| `pnpm db:migrate`         | Aplica migrations Drizzle pendentes                        |
| `pnpm db:seed:if-empty`   | Seed idempotente (somente quando `users` está vazia)       |

---

## Estrutura do projeto

```
navedesk/
├── docker-compose.yml          # serviços `db` e `app` (produção)
├── docker-compose.dev.yml      # override para hot reload
├── Dockerfile                  # multi-stage (deps → builder → runner)
├── drizzle.config.ts
├── public/                     # logo, favicon, uploads
├── src/
│   ├── app/                    # rotas Next.js (App Router)
│   │   ├── (auth)/             # /login
│   │   ├── (app)/              # área autenticada
│   │   └── api/                # route handlers (auth, uploads)
│   ├── actions/                # Server Actions
│   ├── services/               # regras de domínio
│   ├── db/                     # schema Drizzle, migrations, repos
│   ├── lib/                    # núcleo puro (sla, policies, schemas, brand)
│   ├── components/
│   │   ├── ui/                 # primitivos
│   │   ├── domain/             # status-badge, sla-meter, etc.
│   │   └── layout/             # sidebar, topbar, page-header
│   ├── styles/tokens.css       # paleta índigo + raios + sombras
│   └── types/
└── scripts/                    # seeds customizados
```

---

## Solução de problemas

- **Porta 4001 ocupada no host.** Mude o mapeamento em `docker-compose.yml` (`ports: ["4002:4001"]`) e atualize `AUTH_URL` no `.env` correspondentemente.
- **`AUTH_SECRET` ausente ou curto.** Gere um novo com `openssl rand -base64 32` e cole em `.env`. Sem ele o app falha no boot.
- **Login não funciona pela LAN.** Confirme que `AUTH_URL` no `.env` aponta pro IP que o usuário acessa, não pra `localhost`. Reinicie com `docker compose restart app`.
- **Banco em estado inconsistente.** `docker compose down -v` recria do zero (apaga dados!). Sempre faça backup com `pg_dump` antes.
- **Uploads sumindo entre subidas.** O Compose usa volume nomeado `uploads`. Só some se você rodar `docker compose down -v`.
- **Firewall bloqueando acesso da LAN.** Veja a seção "Disponibilizar pra rede" acima.
