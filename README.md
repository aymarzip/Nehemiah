# Nehemiah

**Nehemiah is an AI Project Director for human + AI development teams. Версия 1.0.0.**

Nehemiah помогает команде не просто закрывать задачи, а повышать вероятность выпуска задуманного продукта до дедлайна. Система раздельно показывает реализацию, проверку, интеграцию и готовность к релизу; вычисляет критический путь и риски из наблюдаемого состояния; предлагает следующий шаг и объясняет его.

`OBSERVE → UNDERSTAND → PLAN → ASSIGN → VERIFY → ADAPT`

## Возможности v1.0.0

- долговременное видение проекта: premise/problem, outcome, core workflow, must/should/nice/excluded scope, ограничения и критерии успеха;
- журнал решений с предложением, явным утверждением, заменой предыдущих решений и полным аудитом;
- AI-декомпозиция в строго проверяемую схему; циклы и неизвестные зависимости отклоняет детерминированное ядро;
- объяснимые назначения с учётом роли, навыков, доступности, текущего контекста, нагрузки, блокеров, критического пути и консервативного AI-усиления;
- `/producer what-now`, `/producer why`, `/producer cut-scope`;
- жизненный цикл `IN_PROGRESS → IMPLEMENTED → VERIFIED → INTEGRATED → SHIPPED` с evidence;
- GitHub webhook intelligence: PR, review, checks, workflow, changed files, contract/integration/stale/unverified/late-change риски;
- явные блокеры, приоритет по тяжести и downstream fan-out;
- deadline engine и относительные стадии Game Jam: exploration, production, scope lock, feature freeze, ship mode;
- персональные настройки коммуникации и smart checkpoints без повторного ввода уже известных GitHub-фактов;
- структурированная память с внутренними citations;
- постоянный Discord Mission Control с implementation/integration/QA/release, критическим путём, рисками, блокерами и milestones;
- Risk Engine v2 с весами, историей и объяснением изменений; release readiness существует отдельно от implementation;
- PostgreSQL 18 для долговременной работы и in-memory режим для разработки; durable webhook inbox и retry-safe worker;
- health, readiness, корреляционные request IDs, redact-safe JSON-логи и безопасные operational metrics.

## AI опционален и не привязан к поставщику

Для запуска Nehemiah не нужен `OPENAI_API_KEY` или другой AI-ключ.

- development/test по умолчанию используют детерминированный `FakeProvider`;
- `AI_PROVIDER=none` запускает приложение без AI: только AI-зависимые операции возвращают `PROVIDER_NOT_CONFIGURED`, все детерминированные функции продолжают работать;
- production без явной настройки провайдера также использует `none`;
- поддерживаются OpenAI, Google Gemini, Anthropic Claude, DeepSeek, OpenRouter, Ollama и generic OpenAI-compatible endpoints;
- модели, ключи, протоколы, tool calling, structured output, reasoning, streaming и provider errors изолированы в `packages/llm`; core не импортирует SDK поставщиков.

Подробнее: [AI providers](docs/ai-providers.md).

## Быстрый запуск без ключей

Требуются Node.js 24 и pnpm 11.21.0.

```bash
corepack enable
corepack prepare pnpm@11.21.0 --activate
pnpm install --frozen-lockfile
pnpm dev:api
```

Проверка:

```bash
curl http://localhost:3000/health
curl http://localhost:3000/ready
curl http://localhost:3000/operations/metrics
```

В development будет активен FakeProvider. Чтобы проверить zero-provider режим, задайте `AI_PROVIDER=none`.

## Demo mode

Demo не требует Discord, GitHub, базы или внешнего AI. Установите `DEMO_MODE=true`, запустите API и вызовите:

```bash
curl -X POST http://localhost:3000/v1/demo/bootstrap \
  -H "content-type: application/json" \
  -H "x-nehemiah-internal-token: $INTERNAL_API_TOKEN" \
  -d '{"discordGuildId":"demo","ownerExternalUserId":"owner","ownerDisplayName":"Demo Owner"}'
```

Фикстура создаёт команду, milestones, граф, GitHub-подобный PR, блокер, решения и два снимка риска. Затем можно вызвать `/producer what-now`, Mission Control, scope-cut и release-readiness сценарии. В Discord при включённом demo mode используйте `/project demo`.

## Durable self-hosting

Настройте `.env` на основе `.env.example`:

```dotenv
STORAGE_DRIVER=postgres
DATABASE_URL=postgresql://nehemiah:replace-with-a-long-random-database-password@localhost:5432/nehemiah
AI_PROVIDER=none
INTERNAL_API_TOKEN=replace-with-a-long-random-secret
POSTGRES_PASSWORD=replace-with-a-long-random-database-password
```

Полный container deployment (API, migration, worker и PostgreSQL):

```bash
docker compose up --build -d
```

API привязан к `127.0.0.1:3000`; публикуйте его только через TLS reverse proxy. Discord adapter
добавляется командой `docker compose --profile discord up --build -d`. Host-native путь для
разработки и диагностики описан в [self-hosting guide](docs/self-hosting.md).

API и worker должны использовать одну PostgreSQL. In-memory режим не предназначен для нескольких процессов и не переживает restart. Миграции выполняются отдельным release-step, а не каждой репликой приложения.

Для Discord добавьте credentials и выполните `pnpm discord:deploy`, затем `pnpm dev:discord`. Для GitHub App настройте webhook secret, доставку `/integrations/webhooks/github`, минимальные события/permissions и свяжите обнаруженную installation/repository с проектом через защищённый API.

## Основные Discord-команды

- `/project setup|status|mission-control|decisions|demo`
- `/team join|preferences`
- `/task mine|update`
- `/producer ask|what-now|why|cut-scope`
- `/blocker add|list|resolve`

Mission Control обновляет сохранённое сообщение вместо создания потока новых сообщений. Все sensitive actions повторно проверяются в application layer; Discord channel visibility и default permissions не считаются security boundary.

## Проверка репозитория

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm validate
```

## Структура

```text
apps/api          HTTP composition root и application services
apps/discord      Discord gateway adapter
apps/worker       durable GitHub webhook worker
packages/core     provider/transport-neutral deterministic domain
packages/database PostgreSQL migrations, stores, GitHub inbox
packages/github   signature verification, event normalization, retries
packages/llm      provider-neutral AI boundary and adapters
packages/discord-kit commands, interaction UX and API client
packages/config   validated runtime configuration
packages/observability structured logs and metrics
packages/shared   technical primitives
```

## Документация

- [Architecture](docs/architecture.md)
- [Product concepts](docs/concepts.md)
- [Domain model](docs/domain-model.md)
- [Game Jam mode](docs/game-jam.md)
- [Task lifecycle and evidence](docs/task-lifecycle.md)
- [Risk model](docs/risk-model.md)
- [Permissions](docs/permissions.md)
- [Discord installation](docs/discord-app.md)
- [GitHub App installation](docs/github-app.md)
- [AI providers](docs/ai-providers.md)
- [Self-hosting](docs/self-hosting.md)
- [Operations and recovery](docs/operations.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Development](docs/development.md)
- [Security](SECURITY.md)
- [v1.0.0 release notes](docs/release-notes-v1.0.0.md)
- [Changelog](CHANGELOG.md)
- [Roadmap](docs/roadmap.md)

## Статус

`v1.0.0`: первый стабильный public API/schema baseline для self-hosted small-team deployments.
Это не managed service и не обещание multi-region/high-scale эксплуатации. Известные ограничения
перечислены в [release notes](docs/release-notes-v1.0.0.md) и [roadmap](docs/roadmap.md).

MIT. См. [LICENSE](LICENSE).
