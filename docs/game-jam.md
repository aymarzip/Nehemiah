# Game Jam mode

`GAME_JAM` использует доли оставшегося времени, поэтому одна policy работает для 24, 48, 72 часов и других длительностей.

| Стадия         | Поведение                                                                |
| -------------- | ------------------------------------------------------------------------ |
| EXPLORATION    | Проверка core experience и рискованных предположений.                    |
| PRODUCTION     | Выполнение утверждённого core scope.                                     |
| SCOPE_LOCK     | Новые системы резко не рекомендуются; additions создают drift evidence.  |
| FEATURE_FREEZE | Приоритет получают integration, tests, fixes и required content.         |
| SHIP_MODE      | Build, packaging, submission, screenshots/assets, credits, QA и backups. |

`what-now` в поздних стадиях подавляет nice-to-have/refactor/polish задачи и усиливает shipping work. Это рекомендация: owner может сделать override, но должен записать Decision типа `OVERRIDE` или `RISK_ACCEPTANCE`.

Scope Guillotine вычисляет только кандидатов: реальные effort savings и удаляемые dependency edges берутся из graph, product impact явно отмечается как estimate, а scope не изменяется без утверждённого `SCOPE_CHANGE`.

Настройки checkpoint cadence и notification policy хранятся для каждого проекта. Demo использует двухчасовой cadence, production default: 24 часа.
