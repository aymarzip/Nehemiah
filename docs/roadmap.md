# Post-v1 roadmap

These are non-blocking improvements for v1.1 and later. They are not advertised as v1.0 features.

## GitHub operations

- Outbound, rate-budgeted backfill for changed-file paths and repository history.
- Installation management and dead-letter replay UI with an administrative audit trail.
- Optional polling reconciliation for events GitHub can no longer redeliver.

## Discord experience

- Durable setup drafts and interaction-level idempotency across adapter restarts.
- Pagination/select menus for very large projects and a broader management surface.

## AI conformance

- A continuously tested live provider/model matrix across quotas, regions, and model revisions.
- Configurable capability overrides for non-standard OpenAI-compatible endpoints.

## Operations and scale

- Published load/chaos benchmarks, SLO dashboards, and automated restore rehearsals.
- Workload identity or mTLS as an alternative to the shared internal service token.
- Versioned public API policy, richer administrative audit export, and multi-region guidance.
