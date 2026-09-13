# Provider-neutral AI layer

AI в Nehemiah: опциональная интеграция. Core/domain не содержит OpenAI SDK types, vendor model
names, credentials или provider behavior.

## Контракт

`LlmProvider` предоставляет:

- `capabilities(model?)`;
- `generate(request)`;
- `generateStructured(request)`;
- `stream(request)`.

Канонические DTO описывают messages/content blocks, images, tools, tool results, JSON Schema,
reasoning policy, streaming events, usage, finish reason и непрозрачный `providerState`.
`providerState` round-trip необходим для thought signatures/reasoning blocks, но домен его не
читает.

Capabilities принадлежат паре provider/model. До transport call adapter проверяет tool calling,
structured output, reasoning, vision и streaming. Если обязательная возможность не поддерживается,
он возвращает `unsupported_capability` вместо скрытой prompt-эмуляции.

Все adapters нормализуют ошибки в `LlmError`: authentication, permission, payment, rate limit,
timeout, context limit, invalid request/response, model not found, content filter, overload,
unavailable, network, aborted и unknown. Сообщения проходят best-effort redaction.

## Режимы без credentials

| `AI_PROVIDER`               | Поведение                                                   |
| --------------------------- | ----------------------------------------------------------- |
| не задан в development/test | `fake`                                                      |
| `fake`                      | Детерминированный сценарный FakeProvider                    |
| `none`                      | Пустой registry; AI call сообщает `provider_not_configured` |
| не задан в production       | `none`                                                      |

`FakeProvider` поддерживает scripted responses, structured values, streaming, tools и scripted
errors. Его следует использовать во всех обычных unit/integration tests.

## Runtime adapters

| Значение            | Adapter                         | Обязательная конфигурация                            | Default base URL                            |
| ------------------- | ------------------------------- | ---------------------------------------------------- | ------------------------------------------- |
| `openai`            | Native OpenAI Responses adapter | `AI_MODEL`, `OPENAI_API_KEY`                         | `https://api.openai.com`                    |
| `gemini`            | Native Google Gemini adapter    | `AI_MODEL`, `GEMINI_API_KEY`                         | `https://generativelanguage.googleapis.com` |
| `anthropic`         | Native Claude Messages adapter  | `AI_MODEL`, `ANTHROPIC_API_KEY`                      | `https://api.anthropic.com`                 |
| `deepseek`          | DeepSeek OpenAI-format dialect  | `AI_MODEL`, `DEEPSEEK_API_KEY`                       | `https://api.deepseek.com`                  |
| `openrouter`        | OpenRouter dialect              | `AI_MODEL`, `OPENROUTER_API_KEY`                     | `https://openrouter.ai/api`                 |
| `ollama`            | Native Ollama adapter           | `AI_MODEL`; `OLLAMA_API_KEY` необязателен            | `http://127.0.0.1:11434`                    |
| `openai-compatible` | Generic configurable adapter    | `AI_MODEL`, `AI_BASE_URL`; `AI_API_KEY` необязателен | задаётся пользователем                      |

`AI_BASE_URL` переопределяет default для выбранного live adapter. Не добавляйте `/v1` вслепую:
adapter сам добавляет свой route согласно протоколу.

Пример Ollama без API key:

```bash
export AI_PROVIDER=ollama
export AI_MODEL=my-local-model
pnpm dev:api
```

Generic no-auth endpoint:

```bash
export AI_PROVIDER=openai-compatible
export AI_BASE_URL=http://127.0.0.1:8080
export AI_MODEL=local-model
pnpm dev:api
```

Если `AI_API_KEY` задан, generic adapter использует Bearer auth. Текущий application composition
root задаёт ему консервативный capability profile: streaming включён, tool calling/reasoning/vision
и structured output выключены. Сам package adapter допускает явные capability overrides, но env
surface v1.0 сохраняет этот conservative profile и пока не экспонирует overrides через env.

## Изоляция различий

- OpenAI использует native Responses mapping и SSE.
- Gemini использует native Gemini request/stream mapping и thought signatures.
- Anthropic переводит system/content/tool/thinking blocks в Messages API.
- DeepSeek сохраняет reasoning content через provider state и использует свой dialect.
- OpenRouter сохраняет reasoning details и provider routing metadata.
- Ollama работает с native `/api/chat` и NDJSON streaming; локальная установка не требует auth.
- Generic adapter поддерживает настраиваемые auth, headers/query, path, SSE/NDJSON dialect и явные
  capabilities на library level.

Эти детали не просачиваются в `apps/api` или `packages/core`.

## Structured output и tools

`generateStructured` выбирает JSON Schema или JSON object согласно capability и затем всегда
парсит/валидирует результат локально. Provider guarantee не считается заменой validation.

Локальный validator намеренно поддерживает ограниченный fail-closed dialect:

- boolean schemas, `type`, `const`, `enum`, `allOf`, `anyOf`, `oneOf`;
- objects: `properties`, `required`, `additionalProperties`, `minProperties`, `maxProperties`;
- arrays: `items`, `minItems`, `maxItems`;
- strings: `minLength`, `maxLength`, `pattern`;
- numbers: `minimum`, `maximum`;
- невалидирующие annotations: `$schema`, `$id`, `$comment`, `title`, `description`, `default`,
  `example`, `examples`, `deprecated`, `readOnly`, `writeOnly`.

Любой другой keyword, включая `$ref`, `$defs`, `not`, conditional/dependent schemas, `format`,
`uniqueItems`, `contains`, `patternProperties`, `multipleOf` и exclusive bounds, не игнорируется:
`generateStructured` завершается с `unsupported_capability` до transport call. Это не утверждение,
что provider не знает такой keyword; локальный слой не может гарантировать его проверку. Расширение
dialect должно сначала добавить локальную реализацию и отрицательные тесты.

Tool arguments также являются внешними данными: вызывающий application service обязан
валидировать их собственной schema и авторизовать действие. Adapter только переводит wire format.

## Streaming и retries

Streaming нормализуется в события start/delta/tool/usage/end/error. Ошибка может появиться после
начала ответа, поэтому partial output не считается успешным завершением. Автоматический retry
допустим только для нормализованных retryable ошибок и до выдачи первого stream event вызывающему.
Настроенный request timeout действует до полного чтения JSON/SSE/NDJSON body, а внешний
`AbortSignal` отдельно нормализуется как `aborted`. JSON и streaming ответы ограничены 8 MiB, а
тело provider error ограничено 1 MiB; превышение завершается как `invalid_response`.

## Live verification

Репозиторные тесты используют mocked/injected transport и не доказывают доступность конкретного
аккаунта, модели, quota или региональной функции. Перед production отдельно проверьте выбранную
модель на:

- plain generation и cancellation;
- заявленные structured/tool capabilities;
- streaming и mid-stream errors;
- context/rate limits и retry-after;
- privacy/retention policy;
- round-trip provider state в tool loop.

Никогда не добавляйте live key в CI или fixtures.
