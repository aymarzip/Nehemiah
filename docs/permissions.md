# Permissions

## Роли

- `OWNER` / `PROJECT_OWNER`: workspace/project ownership, integrations, settings и approvals.
- `PRODUCER`: project planning, decisions, assignment, scope and checkpoint management.
- `MEMBER`/domain roles (`DEVELOPER`, `QA`, `RELEASE`): view, own task updates, blockers, preferences, what-now/why.
- `VIEWER`/`INTEGRATION`: read or integration-only principals in deployments that expose them.

Создатель workspace получает `OWNER` и `PRODUCER`. `/team join` отбрасывает privileged role names, поэтому self-registration не повышает права.

Sensitive routes требуют external actor identity и проверяют членство/роль в application layer. К ним относятся task graph mutations, AI decomposition, assignment approval, vision/decision approval, project settings, GitHub linking и memory writes. Task status update разрешён только текущему owner задачи.

`INTERNAL_API_TOKEN` защищает API boundary между Discord adapter и API. В production он обязателен. Это service credential; Discord user ID всё равно проверяется против workspace membership. `ManageGuild`: дополнительная проверка setup/demo UX, но не единственная security boundary.

GitHub repository связывается только после verified webhook discovery активной installation, точного совпадения configured full name и tenant/workspace проверки. Installation tokens не сохраняются.
