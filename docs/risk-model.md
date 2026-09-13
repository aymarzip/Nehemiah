# Risk model v2

Risk score детерминирован и объясним. Он не является "AI score" и не обещает статистическую точность.

Текущие сигналы: critical task without owner, overdue critical-path task, blocked critical task, failing required checks, unreviewed high-impact change, shrinking deadline buffer, stale integrated build, increasing unfinished scope и unresolved integration dependency.

Каждый сигнал имеет конфигурируемый weight, evidence и affected task IDs. Один signal code создаёт один stable risk identity, что предотвращает дубликаты. Снимки сохраняют score, severity, active signals и delta; checkpoint возвращает, почему score вырос или снизился.

GitHub Intelligence добавляет отдельные findings: contract change, overlapping parallel work, stale blocking PR, unverified completion и broad/high-impact late change. Эти findings основаны на repository metadata и не включают число коммитов.

Deadline forecast показывает `LOW|MEDIUM|HIGH` confidence из полноты реальных estimates и ownership. Это плановая confidence, а не вероятность в процентах.

Release readiness не равна risk score: отдельные gates проверяют required scope, high/critical blockers, required checks, build, packaging и critical risks.
