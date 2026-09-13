# Локальная разработка

## Требования

- Node.js `>=24 <25`;
- pnpm `>=11 <12`, рекомендуемая точная версия `11.21.0`;
- Docker с Compose plugin для PostgreSQL 18;
- Git для обычного contribution flow.

AI API key не является prerequisite.

## Установка

```bash
corepack enable
corepack prepare pnpm@11.21.0 --activate
pnpm install --frozen-lockfile
```

Lockfile обязателен. Не запускайте другой package manager и не добавляйте nested lockfiles.

## Конфигурация окружения

Dev/start/Discord deploy/database scripts используют `--env-file-if-exists=../../.env` и поэтому
автоматически читают опциональный root `.env`. Скопируйте `.env.example` в `.env` для постоянной
локальной настройки либо передавайте переменные одним из способов:

- `export NAME=value` в POSIX shell;
- `$env:NAME = "value"` в PowerShell;
- IDE run configuration;
- container/orchestrator secret injection.

Уже заданное окружение имеет приоритет над env-file. Не коммитьте `.env`; в production используйте
secret manager.

### Общие значения

| Переменная                | Default       | Назначение                                              |
| ------------------------- | ------------- | ------------------------------------------------------- |
| `NODE_ENV`                | `development` | `development`, `test`, `production`                     |
| `LOG_LEVEL`               | `info`        | Pino level, включая `silent`                            |
| `HOST`                    | `127.0.0.1`   | API bind host; задайте явно для container/remote access |
| `PORT`                    | `3000`        | API port                                                |
| `STORAGE_DRIVER`          | `memory`      | `memory` или `postgres`                                 |
| `DATABASE_URL`            | -             | обязательна для PostgreSQL                              |
| `DATABASE_POOL_SIZE`      | `10`          | 1-100 connections                                       |
| `INTERNAL_API_TOKEN`      | -             | API<->Discord token; обязателен в production            |
| `WORKER_POLL_INTERVAL_MS` | `1000`        | 100-60000 ms                                            |
| `WORKER_BATCH_SIZE`       | `20`          | 1-500 events                                            |

Полная AI-матрица находится в [ai-providers.md](ai-providers.md).

## Zero-key demo

```bash
pnpm dev:api
```

Development default: memory storage + deterministic FakeProvider. Проверка:

```bash
curl http://localhost:3000/health
```

Чтобы моделировать отсутствие AI:

```bash
AI_PROVIDER=none pnpm dev:api
```

PowerShell:

```powershell
$env:AI_PROVIDER = "none"
pnpm dev:api
```

`/health`, setup, team, tasks, status, graph, risk и memory работают; `/producer ask` возвращает
HTTP 503 с `PROVIDER_NOT_CONFIGURED`.

`/health`: liveness/config snapshot, а не readiness probe: он не выполняет запрос к PostgreSQL или
live LLM provider.

## PostgreSQL

```bash
docker compose up -d postgres
```

Compose запускает PostgreSQL 18.6; сначала задайте `POSTGRES_PASSWORD` в `.env`.

```bash
export STORAGE_DRIVER=postgres
export DATABASE_URL=postgresql://nehemiah:replace-with-a-long-random-database-password@localhost:5432/nehemiah
pnpm db:migrate
pnpm db:seed
```

`db:seed` сначала применяет миграции, затем идемпотентно создаёт `Nehemiah Demo` и одну critical
task, если проект ещё отсутствует.

### Как работают миграции

- Файлы `packages/database/migrations/NNN_name.sql` применяются лексикографически.
- `nehemiah_migrations` хранит применённые имена.
- Один advisory lock защищает от concurrent migrators.
- Каждый файл выполняется в отдельной транзакции.
- Повторный `pnpm db:migrate` безопасен и должен вывести `Database is already up to date.`

Для изменения схемы добавьте следующий файл; не изменяйте уже применённую миграцию.

## Запуск процессов

В отдельных терминалах с одинаковым storage configuration:

```bash
pnpm dev:api
pnpm dev:worker
pnpm dev:discord
```

Или `pnpm dev`, если Discord credentials уже доступны. Без `DISCORD_TOKEN` и
`DISCORD_APPLICATION_ID` Discord process ожидаемо не стартует; это не AI credential requirement.

Production-like запуск после build:

```bash
pnpm build
pnpm start:api
pnpm start:worker
pnpm start:discord
```

В memory mode worker имеет отдельный процессный inbox и не видит события API. Для реальной
асинхронной обработки используйте PostgreSQL.

## HTTP vertical slice

| Method/path                                 | Назначение                            |
| ------------------------------------------- | ------------------------------------- |
| `GET /health`                               | Version, storage и AI configured flag |
| `POST /v1/projects/setup`                   | Workspace/project и owner             |
| `GET /v1/projects/by-guild/:guildId/status` | Health, phase, risk, critical path    |
| `POST /v1/team/join`                        | Профиль участника                     |
| `GET /v1/tasks/mine`                        | Назначенные задачи                    |
| `POST /v1/projects/:projectId/tasks`        | Создание задачи                       |
| `POST /v1/tasks/:taskId/dependencies`       | Dependency edge                       |
| `PATCH /v1/tasks/:taskId/status`            | Guarded lifecycle transition          |
| `POST /v1/producer/ask`                     | Опциональный AI answer                |
| `POST/GET /v1/projects/:projectId/memory`   | Structured memory                     |
| `POST /integrations/webhooks/github`        | Raw GitHub webhook ingestion          |

Если `INTERNAL_API_TOKEN` задан, каждый `/v1/*` запрос должен содержать
`x-nehemiah-internal-token`. Webhook route использует отдельную GitHub HMAC authentication.
В development без token `/v1/*` открыт и принимает `externalUserId` из запроса; безопасный default
host: loopback `127.0.0.1`. Не публикуйте такой процесс в сеть.

## Проверки

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

`pnpm validate` запускает formatting check, lint, typecheck, tests и build.

Дополнительные команды:

```bash
pnpm test:unit
pnpm test:integration
pnpm test:coverage
pnpm format
```

Тесты используют in-memory/`pg-mem`, injected HTTP transport и `FakeProvider`. Они не должны
требовать network access или live secrets.

## Диагностика

- `DATABASE_URL is required`: выбран `STORAGE_DRIVER=postgres`, но URL не экспортирован.
- `INTERNAL_API_TOKEN is required in production`: задайте отдельный случайный service token.
- `No AI provider is configured`: это штатно для `AI_PROVIDER=none`; используйте deterministic
  endpoints или выберите FakeProvider.
- Discord `401`: значения `INTERNAL_API_TOKEN` у API и Discord process различаются.
- GitHub `INVALID_SIGNATURE`: proxy/body parser изменил raw JSON либо неверен
  `GITHUB_WEBHOOK_SECRET`.
- Worker в memory mode предупреждает об isolated inbox: включите PostgreSQL.

## CI parity

GitHub Actions использует Node 24, pnpm 11.21.0, frozen install и PostgreSQL 18. Перед PR локально
выполните те же format/lint/typecheck/test/build gates и дважды примените миграции к чистой базе.
