# Nehemiah v1.0.0 release notes

Nehemiah is an AI Project Director for human + AI development teams. It keeps a small development
team focused on what can actually ship: dependency-aware work, evidence, deadline pressure,
integration state, explainable risk, and release readiness.

## Highlights

- Project vision, decisions, memory, members, milestones, blockers, and assignments in one durable
  PostgreSQL-backed model.
- Deterministic dependency graph, cycle prevention, critical path, Game Jam phases, risk scoring,
  and release gates.
- Discord setup, daily task flow, producer guidance, and persistent Mission Control.
- HMAC-verified GitHub App webhooks with delivery deduplication, bounded retry, repository
  authorization, task-linked PR/check/workflow evidence, and out-of-order event protection.
- Optional AI-assisted decomposition and producer answers across several providers. Invalid or
  hostile model output cannot bypass authorization or deterministic graph/domain validation.
- Health, readiness, metrics, correlation-aware structured logs, containers, Compose, and a
  PostgreSQL migration release step.

## Install

The shortest durable path is Docker Compose. Copy `.env.example` to `.env`, replace all secret
placeholders, choose an AI mode (`none` is valid), then run:

```bash
docker compose config
docker compose up --build -d
curl --fail http://127.0.0.1:3000/ready
```

See [self-hosting](self-hosting.md), [Discord App](discord-app.md), [GitHub App](github-app.md), and
[AI providers](ai-providers.md) for complete configuration.

## Important configuration

Production requires `NODE_ENV=production`, `STORAGE_DRIVER=postgres`, `DATABASE_URL`, and a random
`INTERNAL_API_TOKEN` of at least 32 characters. A configured `GITHUB_WEBHOOK_SECRET` must also be at
least 32 characters. AI credentials are optional; use `AI_PROVIDER=none` for deterministic-only
operation. Keep `/v1/*` private and terminate TLS/rate limits at a trusted ingress.

## Upgrade notes

This is the first stable release. Back up PostgreSQL before upgrading any pre-release deployment,
then apply the committed migrations with `pnpm db:migrate` or the Compose `migrate` service before
starting v1 processes. The repository contains no historical release commit or supported pre-v1
upgrade fixture, so a clean PostgreSQL 18 migration and a rehearsal on a copy of existing data are
required before adopting the release.

## Known limitations

- GitHub is webhook-driven; no outbound changed-file backfill, polling reconciliation, installation
  UI, or dead-letter replay UI is included.
- Live AI adapters are transport-tested but model revisions, quotas, regions, and vendor policies
  require deployment-specific conformance testing.
- Discord setup drafts are process-memory state; confirmed projects are durable. Very large lists
  do not yet have comprehensive pagination.
- Metrics are process-local. Nehemiah does not ship a WAF, managed backup/restore, multi-region
  failover, SLO dashboard, or load/chaos certification.
- The internal API uses a shared service token and must not be treated as a public end-user API.
