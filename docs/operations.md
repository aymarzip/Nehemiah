# Operations and recovery

## What must be backed up

PostgreSQL is the system of record. Back up the entire database, including `nehemiah_migrations`,
project/team/task/evidence tables, GitHub installation mappings and webhook inbox, project memory,
notification state, and risk history. Nehemiah does not provide a managed backup service.

Use your platform's continuous backup/PITR facility or scheduled `pg_dump` plus encrypted,
access-controlled off-host storage. Choose retention and recovery objectives before production use.
Run a restore rehearsal into an isolated PostgreSQL 18 instance, apply the current migrations, start
the API/worker, and verify `/ready` plus a representative project before considering a backup valid.

Redis is not a dependency in v1.0, so there is no Redis state to preserve. Process memory (including
in-memory development projects and unsubmitted Discord setup drafts) is disposable and is lost on
restart. Production refuses `STORAGE_DRIVER=memory`.

## Secret and configuration recovery

Store `.env` values in a secret manager or encrypted operator backup, separately from database
backups. Recover or rotate these independently: PostgreSQL credentials, `INTERNAL_API_TOKEN`,
Discord token/application ID, GitHub webhook secret, and each LLM provider key. Rotation of the
internal token must be coordinated between API and Discord; webhook-secret rotation must be
coordinated with GitHub. Never restore secrets into logs or issue attachments.

## Restart behavior

- API restart: committed PostgreSQL state remains; in-flight HTTP requests may be retried by the
  caller only when the operation is known to be idempotent.
- Worker restart: pending events remain. A processing lease becomes reclaimable after the stale
  interval; a claim token prevents an old worker from acknowledging the reclaimed delivery.
- Discord restart: confirmed data remains; an unsubmitted setup modal draft is lost.
- Database restart: API `/ready` fails until connectivity returns; the worker backs off by its poll
  loop and resumes pending deliveries afterward.

## Failed webhook visibility

Structured worker logs include delivery/correlation identifiers without payload secrets. Inspect
terminal events with a read-only database account:

```sql
SELECT delivery_id, event_name, attempts, last_error, received_at
FROM github_webhook_events
WHERE status = 'FAILED'
ORDER BY received_at DESC;
```

There is no administrative replay UI in v1.0. Before manually replaying, determine whether the
handler side effects are safe and preserve the original delivery identity; never edit project truth
or delete inbox history merely to silence an alert.

## Monitoring baseline

Monitor `/health`, `/ready`, `/operations/metrics`, process restarts, PostgreSQL availability and
capacity, failed webhook rows, LLM error categories, and log correlation IDs. Metrics are
process-local and need an external collector/alerting system. The API has no built-in WAF or public
rate limiter; use an ingress/API gateway and keep the internal API private.
