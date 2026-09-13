import type { AppConfig } from "@nehemiah/config";
import { createLlmRegistry, type ConfiguredProvider, type LlmRegistry } from "@nehemiah/llm";

function fakeProvider(): ConfiguredProvider {
  return {
    kind: "fake",
    id: "fake",
    model: "nehemiah-deterministic",
    scenarios: [
      {
        name: "deterministic-task-decomposition",
        times: Number.POSITIVE_INFINITY,
        matches: ({ request }) => request.metadata?.["operation"] === "task_decomposition",
        response: ({ request }) => {
          const goal =
            request.messages
              .filter((entry) => entry.role === "user")
              .flatMap((entry) => entry.content)
              .filter((entry) => entry.type === "text")
              .map((entry) => entry.text)
              .at(-1) ?? "Deliver the requested feature";
          return {
            text: JSON.stringify({
              tasks: [
                {
                  key: "contract",
                  title: `Define acceptance contract for ${goal.slice(0, 80)}`,
                  description:
                    "Capture the observable behavior, integration boundary and failure cases.",
                  expectedOutcome: "An approved, testable contract with explicit failure behavior.",
                  ownerRole: "Producer",
                  estimatedEffortHours: 1,
                  impact: "HIGH",
                  riskLevel: "MEDIUM",
                  dependencyKeys: [],
                  verificationRequirements: ["Acceptance criteria are reviewable and unambiguous"],
                  suggestedEvidence: ["REVIEW"],
                  component: "product",
                  deadlineCriticality: "CRITICAL",
                  scopeTier: "MUST",
                },
                {
                  key: "implementation",
                  title: `Implement ${goal.slice(0, 100)}`,
                  description:
                    "Implement the smallest complete vertical slice described by the contract.",
                  expectedOutcome: "The feature works through its real integration boundary.",
                  ownerRole: "Developer",
                  estimatedEffortHours: 4,
                  impact: "CRITICAL",
                  riskLevel: "HIGH",
                  dependencyKeys: ["contract"],
                  verificationRequirements: ["Automated tests cover the main and failure paths"],
                  suggestedEvidence: ["PULL_REQUEST", "TEST_RESULT"],
                  component: "application",
                  deadlineCriticality: "CRITICAL",
                  scopeTier: "MUST",
                },
                {
                  key: "integration",
                  title: `Integrate and verify ${goal.slice(0, 80)}`,
                  description:
                    "Exercise the vertical slice in the integrated product and produce a usable build.",
                  expectedOutcome: "Integration checks pass and a reviewer can verify the feature.",
                  ownerRole: "Developer",
                  estimatedEffortHours: 2,
                  impact: "HIGH",
                  riskLevel: "MEDIUM",
                  dependencyKeys: ["implementation"],
                  verificationRequirements: [
                    "Integration test passes",
                    "Review approval is recorded",
                  ],
                  suggestedEvidence: ["CHECK_RUN", "BUILD", "REVIEW"],
                  component: "integration",
                  deadlineCriticality: "CRITICAL",
                  scopeTier: "MUST",
                },
              ],
            }),
          };
        },
      },
      {
        name: "project-aware-development-answer",
        times: Number.POSITIVE_INFINITY,
        response: ({ request }) => {
          const question = request.messages
            .filter((entry) => entry.role === "user")
            .flatMap((entry) => entry.content)
            .filter((entry) => entry.type === "text")
            .map((entry) => entry.text)
            .at(-1);
          return {
            text: `FakeProvider is active. I received the project question: "${(question ?? "").slice(0, 240)}". Configure an optional live provider for generative recommendations; all deterministic status, graph, deadline, health, and risk results are already active.`,
          };
        },
      },
    ],
  };
}

export function createConfiguredLlmRegistry(ai: AppConfig["ai"]): LlmRegistry {
  let provider: ConfiguredProvider | undefined;
  switch (ai.provider) {
    case "none":
      return createLlmRegistry(undefined);
    case "fake":
      provider = fakeProvider();
      break;
    case "openai":
      provider = {
        kind: "openai",
        id: "openai",
        model: ai.model!,
        apiKey: ai.apiKey!,
        ...(ai.baseUrl === undefined ? {} : { baseUrl: ai.baseUrl }),
        timeoutMs: ai.timeoutMs,
      };
      break;
    case "gemini":
      provider = {
        kind: "gemini",
        id: "gemini",
        model: ai.model!,
        apiKey: ai.apiKey!,
        ...(ai.baseUrl === undefined ? {} : { baseUrl: ai.baseUrl }),
        timeoutMs: ai.timeoutMs,
      };
      break;
    case "anthropic":
      provider = {
        kind: "anthropic",
        id: "anthropic",
        model: ai.model!,
        apiKey: ai.apiKey!,
        ...(ai.baseUrl === undefined ? {} : { baseUrl: ai.baseUrl }),
        timeoutMs: ai.timeoutMs,
      };
      break;
    case "deepseek":
      provider = {
        kind: "deepseek",
        id: "deepseek",
        model: ai.model!,
        apiKey: ai.apiKey!,
        ...(ai.baseUrl === undefined ? {} : { baseUrl: ai.baseUrl }),
        timeoutMs: ai.timeoutMs,
      };
      break;
    case "openrouter":
      provider = {
        kind: "openrouter",
        id: "openrouter",
        model: ai.model!,
        apiKey: ai.apiKey!,
        ...(ai.baseUrl === undefined ? {} : { baseUrl: ai.baseUrl }),
        timeoutMs: ai.timeoutMs,
      };
      break;
    case "ollama":
      provider = {
        kind: "ollama",
        id: "ollama",
        model: ai.model!,
        ...(ai.apiKey === undefined ? {} : { apiKey: ai.apiKey }),
        ...(ai.baseUrl === undefined ? {} : { baseUrl: ai.baseUrl }),
        timeoutMs: ai.timeoutMs,
      };
      break;
    case "openai-compatible":
      provider = {
        kind: "openai-compatible",
        id: "openai-compatible",
        baseUrl: ai.baseUrl!,
        model: ai.model!,
        auth: ai.apiKey === undefined ? { type: "none" } : { type: "bearer", token: ai.apiKey },
        timeoutMs: ai.timeoutMs,
        capabilities: {
          streaming: true,
          toolCalling: false,
          parallelToolCalls: false,
          structuredOutput: "none",
          reasoning: false,
          vision: false,
          providerState: true,
        },
      };
      break;
  }
  if (provider === undefined) {
    throw new Error(`Unsupported AI provider: ${String(ai.provider)}`);
  }
  return createLlmRegistry({
    providers: [provider],
    defaultProviderId: provider.id ?? provider.kind,
  });
}
