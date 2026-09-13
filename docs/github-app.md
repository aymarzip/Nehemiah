# GitHub App v1.0

Nehemiah использует GitHub App/webhooks, а не PAT. Core project truth не зависит от доступности GitHub.

## Минимальная настройка

Webhook URL: `https://your-host/integrations/webhooks/github`. Задайте случайный `GITHUB_WEBHOOK_SECRET` в GitHub App и API. Подпишитесь только на используемые события: push, pull request, pull request review, issues, check run/suite, workflow run, installation и installation repositories.

Для webhook ingestion contents/repository permissions не нужны: выдавайте только доступ к
metadata и выбранным webhook events. Текущий релиз не использует installation token и не выполняет
outbound GitHub API requests.

## Безопасная доставка

API получает raw UTF-8 payload в отдельном Fastify scope, проверяет `X-Hub-Signature-256` HMAC-SHA256 constant-time и только затем парсит JSON. `X-GitHub-Delivery`: idempotency key. Verified event атомарно попадает в PostgreSQL inbox и получает 2xx быстро; worker обрабатывает его асинхронно.

Worker использует `FOR UPDATE SKIP LOCKED`, attempts, exponential retry и claim token. Stale worker не может подтвердить reclaimed lease. После max attempts event становится terminal failed; project truth не теряется.

Все payload остаются `untrusted_external` и никогда не становятся trusted LLM instructions.

## Installation/repository linking

Signed installation events создают active/inactive installation и numeric repository mapping. Имя `owner/repo` само по себе не даёт права связать проект. Owner вызывает protected link API; store проверяет:

- installation активна и обнаружена verified webhook;
- numeric repository принадлежит этой installation и active;
- full name точно совпадает с configured project repository;
- installation workspace и repository project не принадлежат другому tenant.

Installation tokens не сохраняются и не логируются.

## Activity, task links и evidence

Normalized signals содержат branch/ref, PR title/number/state/url, review, issue, checks/workflow, changed files из доступных payload и timestamps. Activity связывается с task через explicit branch/PR/issue link, task UUID в metadata/payload или явные task metadata; при сомнении остаётся project-level.

Безопасные linked events добавляют idempotent evidence: PR, review, check, test/workflow и commit reference. Merge/check не переводит task автоматически через lifecycle: state machine всё равно требует корректный переход. Commit count не измеряет продуктивность.

GitHub Intelligence детерминированно ищет contract change with dependants, overlapping parallel work, stale blocking PR, missing expected evidence и broad/high-impact late change. Noisy per-commit notifications не создаются; failed linked checks создают deduplicated high-priority event.

## Ограничения

Webhook PR event сообщает changed-file count, но обычно не полный file list; без outbound API backfill path-based analysis может быть неполным. Installation UI/callback, dead-letter replay UI и outbound mutations не входят в v1.0.0.
