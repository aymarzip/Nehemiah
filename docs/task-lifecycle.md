# Task lifecycle and evidence

```text
PLANNED → READY → IN_PROGRESS → IMPLEMENTED → VERIFIED → INTEGRATED → SHIPPED
```

`BLOCKED` и `CANCELLED`: явные состояния. Task state machine проверяет допустимый переход, владельца, dependency requirements и evidence. PostgreSQL transition повторно блокирует project/task row и проверяет исходные `status`/`updatedAt`, поэтому stale параллельный запрос не коммитит уже недопустимый переход.

## Смысл состояний

- `IMPLEMENTED`: результат существует, но ещё не доказана корректность.
- `VERIFIED`: выполнены требования проверки.
- `INTEGRATED`: результат проверен в общей системе/сборке.
- `SHIPPED`: release/deployment evidence подтверждает выпуск.

Evidence: commit, pull request, review, check run, test result, build, artifact, deployment, manual verification и note. Для high-impact задач одного "done" недостаточно. GitHub может безопасно добавить evidence по явно связанной задаче; commit count никогда не используется как productivity score.

AI decomposition заполняет expected outcome, owner role, effort, impact/risk, dependencies, verification requirements, suggested evidence, component, deadline criticality и scope tier. JSON Schema проверяется локально, затем `TaskDecompositionValidator` отклоняет duplicate keys, unknown dependencies и cycles, и только после этого store атомарно сохраняет plan.
