# Troubleshooting

## API запускается, AI отвечает 503

Это нормальный `AI_PROVIDER=none`: graph, status, deadlines, risks, Mission Control и GitHub продолжают работать. Для локальной детерминированной декомпозиции используйте `AI_PROVIDER=fake`; внешний ключ не нужен.

## `/ready` возвращает 503

Проверьте `DATABASE_URL`, PostgreSQL network/TLS и применённую миграцию `002_phase2_product.sql`. `/health` означает живой процесс, а `/ready` доступность хранилища.

## Discord command устарела

Повторно выполните `pnpm discord:deploy`. Для разработки задайте `DISCORD_DEV_GUILD_ID`; guild commands обновляются быстрее global. Не deploy-команды на каждом `ready`.

## Mission Control не создаётся

Проверьте `Send Messages`, `Embed Links`, доступ бота к каналу и server-side роль пользователя. Команда обновляет сохранённый message ID; удалённое сообщение будет создано заново.

## GitHub webhook отклонён

Сверьте exact raw payload, `X-Hub-Signature-256`, `X-GitHub-Event`, `X-GitHub-Delivery` и `GITHUB_WEBHOOK_SECRET`. JSON проверяется только после HMAC. Duplicate delivery получает безопасный 2xx/accepted response без повторных effects.

## GitHub activity не связалась с задачей

Используйте защищённый task GitHub link endpoint для branch/PR/issue. Осторожная эвристика ищет task UUID или явные metadata fields; сомнительная активность остаётся project-level и не создаёт task evidence.

## Worker повторяет событие

Проверьте `last_error`, attempts и lease. Transient failure получает exponential retry; после max attempts событие terminal. Claim token предотвращает stale worker acknowledgement.

## Модель вернула неправильный JSON

Nehemiah возвращает `INVALID_MODEL_OUTPUT` и не меняет graph. Проверьте capabilities выбранной модели/endpoint. FakeProvider воспроизводит успешную схему для tests/demo.
