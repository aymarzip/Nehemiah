# Участие в разработке Nehemiah

Спасибо за вклад. Главный критерий изменения: оно должно усиливать Nehemiah как **AI Project
Director для команд людей и AI**, сохраняя детерминированное ядро и явные интеграционные границы.

## Перед началом

1. Прочитайте [архитектуру](docs/architecture.md), [доменную модель](docs/domain-model.md) и
   [security policy](SECURITY.md).
2. Для существенного изменения сначала опишите проблему, инварианты и ожидаемое поведение в issue
   или design note.
3. Не добавляйте инфраструктуру или абстракцию без конкретного v1.x use case.

## Среда

- Node.js 24;
- pnpm 11.21.0 через Corepack;
- Docker Compose для тестирования с PostgreSQL 18;
- никаких live AI credentials для обычной разработки и тестов.

```bash
corepack enable
corepack prepare pnpm@11.21.0 --activate
pnpm install --frozen-lockfile
pnpm validate
```

Root `.env` опционально загружается dev/start/Discord deploy/database scripts через
`--env-file-if-exists`; начните с `.env.example`. Уже заданное окружение имеет приоритет. Никогда не
коммитьте заполненный `.env`, а в production используйте secret manager.

## Архитектурные правила

- `packages/core` не импортирует Discord, GitHub, базы данных или vendor SDK.
- Детерминированная логика графа, lifecycle, permissions, risk и deadline остаётся в core.
- Входные данные Discord, GitHub и пользователей считаются недоверенными и валидируются на
  границе.
- LLM не принимает доменные решения, которые можно воспроизводимо вычислить.
- Provider-specific wire format, credentials, capability quirks, streaming и ошибки остаются в
  конкретном adapter внутри `packages/llm`.
- Новый AI adapter обязан реализовать общий `LlmProvider`, явно объявить capabilities и вернуть
  нормализованный `LlmError`. Неподдерживаемая обязательная возможность должна завершаться
  `unsupported_capability`, а не тихо эмулироваться prompt-ом.
- Сохраняйте `providerState` непрозрачным: core не должен интерпретировать signatures или reasoning
  blocks провайдера.
- SQL должен быть параметризован. Изменения схемы оформляются новой миграцией; уже выпущенную
  миграцию не переписывают.
- TypeScript остаётся strict, ESM-импорты используют `.js` suffix.

## Тестирование

Изменение должно включать тест, который доказывает требуемое поведение, а не только увеличивает
coverage.

Приоритетные области:

- cycle detection, ready/blocked tasks и critical path;
- lifecycle/evidence/dependency guards;
- все risk signals и границы severity;
- deadline phases и buffer;
- permission checks;
- raw webhook signature и delivery idempotency;
- retry-safe persistence и migrations;
- provider mapping, structured output, streaming и normalized errors;
- end-to-end HTTP/Discord vertical slice.

Используйте `FakeProvider` или injected mock transport. Тесты по умолчанию не должны обращаться к
интернету и не должны требовать API key.

```bash
pnpm test:unit
pnpm test:integration
pnpm test:coverage
```

Для PostgreSQL smoke test:

```bash
docker compose up -d postgres
export DATABASE_URL=postgresql://nehemiah:replace-with-a-long-random-database-password@localhost:5432/nehemiah
pnpm db:migrate
pnpm db:migrate
```

Повторный запуск должен сообщить, что схема актуальна.

## Pull request checklist

- [ ] Изменение находится в правильном модуле и не нарушает dependency direction.
- [ ] Добавлены meaningful tests для нового поведения и ошибок.
- [ ] `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test` и `pnpm build` проходят.
- [ ] Миграция проверена на чистой PostgreSQL 18 базе и повторным запуском.
- [ ] Документация и `.env.example` отражают новые публичные настройки.
- [ ] В diff нет токенов, private keys, webhook secrets, персональных данных и больших payload dump.
- [ ] Новое внешнее содержимое не превращается в trusted LLM instruction.
- [ ] Ограничения и обратная совместимость описаны явно.

## Стиль изменений

Предпочитайте небольшие cohesive commits. Не отключайте проверки, не ослабляйте strictness и не
подменяйте незавершённую логику `TODO` на critical path. Ошибки должны быть понятны пользователю,
но не раскрывать secrets или внутренний payload.

Сообщения и документация могут быть на русском или английском; публичные API identifiers и код
остаются на английском.
