# Политика безопасности

## Сообщение об уязвимости

Не публикуйте уязвимость, credential или exploit в открытом issue. Используйте private
vulnerability reporting репозитория, если он включён, либо другой приватный канал, указанный
владельцами репозитория. Передайте:

- затронутую версию/commit;
- сценарий и impact;
- минимальные шаги воспроизведения;
- известные обходные меры;
- только синтетические credentials и обезличенные данные.

Подтверждение получения и сроки исправления зависят от доступности maintainers; публичное раскрытие
следует координировать после появления исправления.

## Поддерживаемая версия

Security fixes применяются к текущей стабильной ветке `v1.x`. Предрелизные Phase 1/2 и `v0.9.x`
snapshots отдельно не поддерживаются.

## Модель угроз

Основные внешние границы:

1. Discord interaction и текст пользователя.
2. Внутренний HTTP API между Discord adapter и API.
3. Сырые GitHub webhook payload и headers.
4. Ответы и ошибки внешнего LLM provider.
5. PostgreSQL и runtime configuration.

Любые Discord/GitHub/repository/LLM данные считаются недоверенными, пока не прошли проверку и
нормализацию. Доменное ядро не исполняет команды из этих данных.

## Реализованные меры

- Runtime configuration валидируется до старта; production требует `INTERNAL_API_TOKEN`.
- Внутренний токен сравнивается constant-time и передаётся в
  `x-nehemiah-internal-token`.
- GitHub HMAC-SHA256 проверяется по точному raw body до JSON parsing; используется
  constant-time compare.
- `X-GitHub-Delivery` является idempotency key. PostgreSQL inbox использует primary key,
  транзакции и `FOR UPDATE SKIP LOCKED`.
- GitHub payload сохраняется с trust level `untrusted_external`; он не становится системной
  LLM-инструкцией.
- HTTP body ограничен 1 MiB, входные DTO валидируются Zod.
- Discord setup требует пользовательское право Manage Server; task update дополнительно проверяет
  ownership на API.
- SQL-запросы параметризованы; миграции выполняются транзакционно под advisory lock.
- Logger redacts распространённые token/key/secret/password paths и не сериализует заголовки
  запроса целиком.
- LLM credentials находятся только в adapter configuration. Provider errors нормализуются и
  проходят best-effort secret redaction.
- Producer разделяет trusted structured project context и untrusted user question, ограничивает
  длину вопроса и запрещает модели принимать его за privileged instruction.
- AI можно полностью отключить: отсутствие API keys не ослабляет детерминированные проверки.

## Управление secrets

- Не коммитьте `.env`, токены, PEM private key, webhook secret или реальные connection strings.
- `.env.example` содержит только placeholder/локальные значения. Созданный из него root `.env`
  автоматически читается локальными scripts и должен оставаться вне version control.
- В production используйте secret manager и разные credentials для разных сред.
- Настройте отдельную ротацию/отзыв для Discord token, webhook secret, internal API token и каждого
  AI provider key.
- GitHub App должен иметь только read-permissions из [руководства](docs/github-app.md).
- Не передавайте secrets в query string, Discord responses, LLM prompts или project memory.

## Production checklist

- Используется `STORAGE_DRIVER=postgres`; in-memory режим не является durable.
- `INTERNAL_API_TOKEN` длинный, случайный и одинаков только у API и Discord adapter.
- API не открыт напрямую в интернет либо защищён ingress/network policy; за исключением webhook route.
- TLS завершается на доверенном proxy, а proxy сохраняет raw webhook body без преобразования.
- PostgreSQL доступен только необходимым процессам, connection string имеет минимальные права.
- GitHub webhook secret ротируется; delivery failures мониторятся.
- Логи и backups имеют ограниченный доступ и retention.
- Live LLM provider получает только необходимый контекст; включены vendor-side privacy controls,
  подходящие проекту.
- Выполнены `pnpm validate`, migration smoke и restore rehearsal.

## Известные ограничения v1.0.0

- Internal API использует один service token, а не mTLS или workload identity.
- В non-production без `INTERNAL_API_TOKEN` namespace `/v1/*` не аутентифицируется и доверяет
  переданному `externalUserId`. Оставляйте default bind `127.0.0.1` и не публикуйте такой процесс.
- Записи project memory входят в trusted system context Producer; memory write endpoint поэтому
  является привилегированным и должен находиться только за защищённым internal API.
- Discord setup drafts хранятся в памяти одного процесса.
- Runtime GitHub slice принимает и обрабатывает webhooks, но пока не выполняет outbound GitHub
  mutations.
- Live AI adapters покрыты детерминированными transport tests, но требуют отдельной
  environment-specific проверки перед production.
- Нет готового rate limiter/WAF и централизованного audit trail для всех административных действий.

Эти ограничения не следует компенсировать выдачей более широких permissions.
