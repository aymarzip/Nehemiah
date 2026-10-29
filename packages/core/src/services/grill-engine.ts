import type { DecisionType } from "../domain/governance.js";

export const GRILL_PILLARS = [
  "ARCHITECTURE",
  "DATA_MODEL",
  "AUTH_SECURITY",
  "API_CONTRACTS",
  "UX_FLOW",
  "PERFORMANCE",
  "DEPLOYMENT",
  "EDGE_CASES",
] as const;

export type GrillPillar = (typeof GRILL_PILLARS)[number];

export interface GrillOption {
  readonly key: string;
  readonly label: string;
  readonly pros: string;
  readonly cons: string;
}

export interface GrillQuestion {
  readonly pillar: GrillPillar;
  readonly question: string;
  readonly tradeoff: string;
  readonly options: readonly GrillOption[];
  readonly recommendedOptionKey: string;
}

export interface GrillSession {
  readonly topic: string;
  readonly taskId?: string;
  readonly questions: readonly GrillQuestion[];
}

export interface GrillAnswerInput {
  readonly question: string;
  readonly selectedOptionKey: string;
  readonly notes?: string | undefined;
}

export interface GrillDecisionDraft {
  readonly type: DecisionType;
  readonly title: string;
  readonly description: string;
  readonly context: string;
  readonly rationale: string;
  readonly outcome: string;
  readonly alternatives: readonly string[];
}

export class TechnicalGrillEngine {
  generateQuestions(topic: string, taskId?: string): GrillSession {
    const normalizedTopic = topic.trim();
    const questions: GrillQuestion[] = [
      {
        pillar: "ARCHITECTURE",
        question: `How should boundaries and component ownership be isolated for "${normalizedTopic}"?`,
        tradeoff:
          "Tight coupling speeds initial prototyping but risks breaking adjacent modules and complicating test isolation.",
        options: [
          {
            key: "ISOLATED_MODULE",
            label: "Dedicated service/module with strict public interface",
            pros: "Clean dependency boundaries, independently testable, minimal regression risk.",
            cons: "Requires formal DTO mapping and upfront interface definition.",
          },
          {
            key: "INLINE_EXTENSION",
            label: "Extend existing core service inline",
            pros: "Faster to ship, zero boilerplate.",
            cons: "Increases module complexity and shared mutable state risk.",
          },
        ],
        recommendedOptionKey: "ISOLATED_MODULE",
      },
      {
        pillar: "DATA_MODEL",
        question: `What persistence and state lifecycle model best fits "${normalizedTopic}"?`,
        tradeoff:
          "In-place mutable updates are straightforward but lack auditability and complicate concurrency handling under load.",
        options: [
          {
            key: "AUDITABLE_APPEND_ONLY",
            label: "Append-only event/log history with derived snapshot",
            pros: "Full rollback capability, safe concurrent writes, transparent audit trail.",
            cons: "Higher storage volume, requires deterministic projection.",
          },
          {
            key: "MUTABLE_WITH_LOCKING",
            label: "Direct row mutation with optimistic lock guard",
            pros: "Simple query pattern, compact storage, instant read-after-write.",
            cons: "Race conflicts require client retry logic; no historical replay.",
          },
        ],
        recommendedOptionKey: "MUTABLE_WITH_LOCKING",
      },
      {
        pillar: "API_CONTRACTS",
        question: `How should failures and partial successes be communicated to callers for "${normalizedTopic}"?`,
        tradeoff:
          "Throwing generic errors causes blunt 500s; overly granular error types increase SDK maintenance.",
        options: [
          {
            key: "TYPED_DOMAIN_ERRORS",
            label: "Categorized machine-readable error codes with human-safe fallback",
            pros: "Caller can branch deterministically without string scraping; secrets never leak.",
            cons: "Needs schema maintenance and status mapping.",
          },
          {
            key: "BOOLEAN_STATUS",
            label: "Simple success boolean with optional message string",
            pros: "Minimal contract, trivial consumption.",
            cons: "Cannot distinguish permissions from network or domain constraint failures.",
          },
        ],
        recommendedOptionKey: "TYPED_DOMAIN_ERRORS",
      },
      {
        pillar: "EDGE_CASES",
        question: `What is the degradation strategy if a dependency or quota fails during "${normalizedTopic}"?`,
        tradeoff:
          "Hard failing protects data consistency; fallback modes preserve user experience at the cost of stale results.",
        options: [
          {
            key: "FAIL_SAFE_DEGRADE",
            label: "Deterministic local fallback mode with degraded status badge",
            pros: "Uninterrupted operations, zero cascading outage for the user.",
            cons: "Client must accept partial or cached data.",
          },
          {
            key: "FAST_FAIL_ABORT",
            label: "Fast-fail with explicit retry-after header",
            pros: "Never returns approximate data, guarantees strict state correctness.",
            cons: "User workflow halts when external dependencies flap.",
          },
        ],
        recommendedOptionKey: "FAIL_SAFE_DEGRADE",
      },
    ];

    return {
      topic: normalizedTopic,
      ...(taskId ? { taskId } : {}),
      questions,
    };
  }

  compileDecision(
    topic: string,
    answers: readonly GrillAnswerInput[],
    taskId?: string,
  ): GrillDecisionDraft {
    const rationaleParts = answers.map(
      (a) =>
        `Q: ${a.question}\nChosen Option: ${a.selectedOptionKey}${a.notes ? ` (${a.notes})` : ""}`,
    );
    const alternatives = answers.map((a) => `Alternative for: ${a.question}`);

    return {
      type: "ARCHITECTURE",
      title: `Technical alignment: ${topic}`,
      description: `Architectural constraints and decisions established through technical grilling on topic: ${topic}.`,
      context: taskId
        ? `Clarified technical trade-offs prior to implementing task ${taskId}.`
        : `Architectural trade-off interrogation for ${topic}.`,
      rationale: rationaleParts.join("\n\n"),
      outcome: `Agreed technical pattern for ${topic} with explicit boundary, data, and degradation rules.`,
      alternatives,
    };
  }
}
