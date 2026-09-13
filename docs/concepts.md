# Product concepts

Nehemiah оптимизирует вероятность выпуска задуманного продукта до дедлайна, а не объём сгенерированного кода.

## Четыре разных вида прогресса

- **Implementation**: код или другой результат создан.
- **Verification**: результат проверен требуемым evidence.
- **Integration**: результат соединён с остальной системой и проверен на общей границе.
- **Release readiness**: required scope, проверки, build, packaging, blockers и release-critical risks позволяют выпуск.

Высокий implementation при низкой integration - это риск, а не успех.

## Источники истины

PostgreSQL служит долговременной project truth, а Discord и GitHub работают как адаптеры. GitHub payload всегда остаётся `untrusted_external`. LLM предлагает, объясняет и интерпретирует естественный язык, но не утверждает scope, не проводит lifecycle transition и не меняет graph без deterministic validation.

## Видение и решения

Approved vision содержит problem, target outcome, core experience/workflow, must/should/nice/excluded scope, constraints и success criteria. AI или человек создаёт proposed revision; owner/producer утверждает её. Значимое изменение фиксируется Decision и может явно supersede более раннее решение.

## Capacity

AI tools хранятся как профиль инструментов, а оценка учитывает implementation throughput, review/integration capacity, observed rework, context-switch cost, reliability и низкую стартовую confidence. Несколько агентов не считаются несколькими людьми.

## Mission Control

Mission Control: сохранённое Discord-сообщение с deadline/phase, четырьмя измерениями прогресса, критическим путём, milestones, top blockers, детерминированными рисками, GitHub findings, drift, next checkpoint и release gates.
