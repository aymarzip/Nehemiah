# Self-hosting v1.0

Nehemiah runs as an API, a webhook worker, optional Discord adapter, and PostgreSQL 18.6. Redis is
not used: the durable inbox, leases, retries, and dead-letter state live in PostgreSQL.

## Prerequisites

- Docker Engine 27+ with the Compose v2 plugin for the container path; or Node.js `>=24 <25`,
  Corepack, pnpm 11.21.0, and PostgreSQL 18 for the host-native path.
- A DNS name and TLS reverse proxy for any internet-facing deployment.
- At least 32 random characters for `INTERNAL_API_TOKEN` and `GITHUB_WEBHOOK_SECRET` when GitHub is
  enabled. Use a password manager or secret manager; do not copy example values to production.

## Container deployment

```bash
cp .env.example .env
```

Edit `.env`: set `POSTGRES_PASSWORD`, `INTERNAL_API_TOKEN`, `NODE_ENV=production`, choose
`AI_PROVIDER`, and add only the provider/Discord/GitHub credentials you use. `POSTGRES_DB` and
`POSTGRES_USER` default to `nehemiah` and may be changed before the first database start. Then run:

```bash
docker compose config
docker compose up --build -d
docker compose ps
curl --fail http://127.0.0.1:3000/health
curl --fail http://127.0.0.1:3000/ready
```

Compose starts PostgreSQL, waits for it to become healthy, applies migrations once, then starts the
API and worker. The API is bound to loopback by default. Start Discord only after completing
[Discord setup](discord-app.md):

```bash
docker compose --profile discord up --build -d
```

Deploy slash commands from a trusted host with the same `.env`:

```bash
pnpm install --frozen-lockfile
pnpm discord:deploy
```

Images use pinned Node 24, an exact pnpm version, frozen dependency installation, separate minimal
runtime targets, and the unprivileged `node` user. `.dockerignore` excludes `.env`, Git history,
local dependencies, and build outputs.

## Host-native deployment

```bash
corepack enable
corepack prepare pnpm@11.21.0 --activate
pnpm install --frozen-lockfile
docker compose up -d postgres
pnpm db:migrate
pnpm build
pnpm start:api
```

Run `pnpm start:worker` in a second supervised process and `pnpm start:discord` only when Discord is
configured. Every process must receive the same `DATABASE_URL` and compatible secrets. Production
configuration rejects in-memory storage and weak service/webhook credentials.

## Network and process model

- Expose `/integrations/webhooks/github` and health endpoints through a TLS proxy only when needed.
- Keep `/v1/*` on a private service network; its shared service token is not a user-auth system.
- Do not transform the raw GitHub request body at the proxy.
- Run migrations as a one-shot release step before new application replicas.
- Graceful SIGTERM closes HTTP listeners/pools with a bounded shutdown deadline; the inbox claim
  token prevents a stopped or stale worker from acknowledging a lease reclaimed by another worker.

## First project

Configure Discord and run `/project setup`, or enable `DEMO_MODE=true` only in a non-production
environment and call `/v1/demo/bootstrap`. A durable real deployment should then verify project
status, member onboarding, a task transition, GitHub repository linking, and Mission Control.

Backups, restore checks, dead-letter inspection, and secret recovery are documented in
[operations](operations.md). Troubleshooting is in [troubleshooting](troubleshooting.md).
