# Discord App v1.0

Discord: основной ежедневный интерфейс Nehemiah. Adapter использует только `GatewayIntentBits.Guilds`; privileged Message Content/Member intents не нужны.

## Установка

1. Создайте Discord application и bot.
2. Добавьте bot в server с `applications.commands`, View Channels, Send Messages, Embed Links и Read Message History.
3. Установите `DISCORD_TOKEN`, `DISCORD_APPLICATION_ID`, `NEHEMIAH_API_URL` и тот же `INTERNAL_API_TOKEN`, что у API.
4. Для разработки задайте `DISCORD_DEV_GUILD_ID`.
5. Выполните `pnpm discord:deploy`, затем `pnpm dev:discord`.

Команды разворачиваются отдельным скриптом, не на каждом `ready`.

## Команды

- `/project setup`: Manage Server + server-side creation check; modal собирает name, premise, vision, deadline и timezone.
- `/project status`: краткие четыре измерения, risk и critical path.
- `/project mission-control`: создаёт или обновляет сохранённое сообщение с кнопками My Task, Project, Risks, Ask Producer и Update Status.
- `/project decisions`: последние proposed/approved/superseded decisions.
- `/project demo`: credential-free evaluation fixture при `DEMO_MODE=true`.
- `/team join`, `/team preferences`: профиль, skills, availability, AI tools и только явные communication settings.
- `/task mine`, `/task update`: owner-only lifecycle/evidence.
- `/producer ask`, `/producer what-now`, `/producer why`, `/producer cut-scope`.
- `/blocker add`, `/blocker list`, `/blocker resolve`.

Potentially slow commands сразу defer response. Personal results ephemeral. Mission Control intentionally public in chosen project channel and updates the recorded message rather than spamming new ones.

## Security

- `interaction.user.id` подставляется adapter, а не берётся из пользовательской option.
- User/guild/member role повторно проверяются API. Discord channel visibility/default command permissions не являются security boundary.
- `/team join` не позволяет self-assign `OWNER`, `PROJECT_OWNER`, `PRODUCER` или `INTEGRATION`.
- Setup modal ID содержит opaque nonce с user/guild binding, TTL и one-time consume.
- Markdown экранируется, mentions отключены, API token не входит в payload.
- Перед public Mission Control adapter проверяет Send Messages и доступность канала.

## Известные ограничения

Setup drafts in-memory; restart до submit требует повторить `/project setup`. Один guild связан с одним project. Long lists не имеют pagination. Admin-heavy task graph/vision/assignment операции доступны через protected HTTP API, а Discord оптимизирован для ежедневной работы.
