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
        pillar: "AUTH_SECURITY",
        question: `What authentication and authorization boundary protects "${normalizedTopic}"?`,
        tradeoff:
          "Fine-grained RBAC guards against unauthorized escalation but adds latency and permission matrix complexity.",
        options: [
          {
            key: "ROLE_BASED_GUARD",
            label: "Explicit workspace/guild role check before service dispatch",
            pros: "Zero unauthorized mutation risk, deterministic audit records.",
            cons: "Requires team profile context for every invocation.",
          },
          {
            key: "PERMISSIVE_INTERNAL",
            label: "Rely solely on network/internal API token boundary",
            pros: "Low latency, trivial internal microservice chaining.",
            cons: "Compromised internal caller has unrestricted domain access.",
          },
        ],
        recommendedOptionKey: "ROLE_BASED_GUARD",
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
        pillar: "UX_FLOW",
        question: `How should long-running operations or waiting states be presented for "${normalizedTopic}"?`,
        tradeoff:
          "Instant ephemeral deferrals keep UI responsive but require async message updates and polling handling.",
        options: [
          {
            key: "DEFERRED_EPHEMERAL",
            label: "Immediate ephemeral deferral with rich status edit",
            pros: "Never times out Discord 3-second gateway budget, clean private UX.",
            cons: "Requires followup message tracking.",
          },
          {
            key: "SYNCHRONOUS_BLOCK",
            label: "Synchronous blocking reply directly in channel",
            pros: "Single network roundtrip, visible to entire channel.",
            cons: "Fails gateway timeout if operation exceeds 3,000ms.",
          },
        ],
        recommendedOptionKey: "DEFERRED_EPHEMERAL",
      },
      {
        pillar: "PERFORMANCE",
        question: `What caching and context budgeting strategy governs "${normalizedTopic}" under load?`,
        tradeoff:
          "Aggressive caching saves tokens and database roundtrips but risks serving stale graph state.",
        options: [
          {
            key: "SUBGRAPH_SLICING",
            label: "Token-bounded graph slicing with 2-hop neighborhood pruning",
            pros: "Cuts LLM context tokens by up to 80% with zero relevance loss.",
            cons: "Slight compute cost for neighborhood discovery.",
          },
          {
            key: "FULL_DUMP",
            label: "Unbounded project task dump into context",
            pros: "Complete global context always available.",
            cons: "Hits token window limits on projects with over 50 tasks.",
          },
        ],
        recommendedOptionKey: "SUBGRAPH_SLICING",
      },
      {
        pillar: "DEPLOYMENT",
        question: `How should migrations and rolling restarts be managed for "${normalizedTopic}"?`,
        tradeoff:
          "Backward-compatible dual-write migrations allow zero-downtime deploys but require multi-phase rollouts.",
        options: [
          {
            key: "EXPAND_CONTRACT",
            label: "Dual-read expand/contract schema evolution",
            pros: "Zero downtime, old and new application instances co-exist safely.",
            cons: "Requires two deployment cycles to clean up legacy columns.",
          },
          {
            key: "MAINTENANCE_MIGRATION",
            label: "Single-phase exclusive schema lock with maintenance window",
            pros: "Fast and simple, no intermediate compatibility shims.",
            cons: "Requires transient downtime or queue pausing.",
          },
        ],
        recommendedOptionKey: "EXPAND_CONTRACT",
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
    const questions = this.generateQuestions(topic, taskId).questions;
    const questionMap = new Map(questions.map((q) => [q.question, q]));

    const rationaleParts: string[] = [];
    const alternatives: string[] = [];

    for (const a of answers) {
      const q = questionMap.get(a.question);
      const chosenOption = q?.options.find((o) => o.key === a.selectedOptionKey);
      const chosenLabel = chosenOption
        ? `${chosenOption.key}: ${chosenOption.label}`
        : a.selectedOptionKey;
      rationaleParts.push(
        `Q: ${a.question}\nSelected: ${chosenLabel}${a.notes ? `\nRationale: ${a.notes}` : ""}`,
      );

      if (q) {
        const rejected = q.options.filter((o) => o.key !== a.selectedOptionKey);
        for (const rej of rejected) {
          alternatives.push(`${rej.key} (${rej.label}): Rejected due to cons: ${rej.cons}`);
        }
      } else {
        alternatives.push(`Alternative considered for question: ${a.question}`);
      }
    }

    return {
      type: "ARCHITECTURE",
      title: `Technical alignment: ${topic}`,
      description: `Architectural constraints and decisions established through technical grilling on topic: ${topic}.`,
      context: taskId
        ? `Clarified technical trade-offs prior to implementing task ${taskId}.`
        : `Architectural trade-off interrogation for ${topic}.`,
      rationale: rationaleParts.join("\n\n"),
      outcome: `Agreed technical pattern for ${topic} with explicit boundary, data, and degradation rules.`,
      alternatives: alternatives.length > 0 ? alternatives : ["Standard inline extension"],
    };
  }
}
