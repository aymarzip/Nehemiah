# Changelog

All notable changes follow [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-08-24

### Added

- Core project orchestration with durable vision, decisions, project memory, team profiles,
  milestones, assignments, blockers, and guarded task lifecycle.
- Discord commands and persistent Mission Control for setup, status, daily work, scope decisions,
  and release-focused coordination.
- Signed GitHub webhook ingestion, installation/repository authorization, durable bounded retries,
  normalized activity, task links, and evidence updates.
- Deterministic task dependency graph, cycle rejection, critical path, deadline/Game Jam phases,
  explainable risk engine, evidence-based progress, and release-readiness gates.
- Optional provider-neutral AI-assisted planning with validated structured output and deterministic
  authorization/state validation.
- PostgreSQL migrations, health/readiness/metrics endpoints, structured redact-safe logs, container
  targets, Compose deployment, and CI release gates.

### Security and reliability

- Production now requires PostgreSQL, a strong internal service token, and strong configured GitHub
  webhook secrets.
- Protected team roles cannot be self-assigned or removed through profile updates.
- Cross-workspace/project authorization is enforced before integration or AI-assisted mutations.
- Out-of-order GitHub events no longer regress activity/evidence, and a successful rerun resolves a
  previously failed check notification.
- LLM JSON/error/stream bodies have bounded response sizes and retain timeouts through body reads.
- Fastify is pinned to patched v5.12.1 after the August 2026 validation/trust-proxy advisories.
- Database queries and process shutdown now have bounded operational deadlines.

### Removed

- Unused outbound GitHub SDK dependency and an unused database-to-core dependency.
