import { DomainValidationError } from "../errors.js";
import {
  assertFiniteNonNegative,
  assertNonEmpty,
  type Impact,
  type ProjectId,
} from "../domain/common.js";
import {
  Task,
  TaskDependency,
  TASK_EVIDENCE_KINDS,
  type TaskEvidenceKind,
} from "../domain/task.js";
import { TaskGraph } from "./task-graph.js";

export interface ProposedTask {
  readonly key: string;
  readonly title: string;
  readonly description: string;
  readonly expectedOutcome: string;
  readonly ownerRole?: string | undefined;
  readonly estimatedEffortHours: number;
  readonly impact: Impact;
  readonly riskLevel: Impact;
  readonly dependencyKeys: readonly string[];
  readonly verificationRequirements: readonly string[];
  readonly suggestedEvidence: readonly string[];
  readonly component?: string | undefined;
  readonly deadlineCriticality: "OPTIONAL" | "IMPORTANT" | "CRITICAL";
  readonly scopeTier: "MUST" | "SHOULD" | "NICE";
}

export interface ValidatedTaskPlan {
  readonly tasks: readonly Task[];
  readonly dependencies: readonly TaskDependency[];
  readonly keyToTaskId: Readonly<Record<string, string>>;
}

export class TaskDecompositionValidator {
  validate(input: {
    readonly projectId: ProjectId;
    readonly proposals: readonly ProposedTask[];
    readonly idForKey: (key: string) => string;
    readonly now?: Date | undefined;
  }): ValidatedTaskPlan {
    if (input.proposals.length === 0)
      throw new DomainValidationError("A decomposition must contain at least one task");
    const keys = new Set<string>();
    const keyToTaskId: Record<string, string> = {};
    for (const proposal of input.proposals) {
      const key = assertNonEmpty(proposal.key, "decomposition.task.key");
      if (keys.has(key)) throw new DomainValidationError(`Duplicate proposed task key '${key}'`);
      keys.add(key);
      keyToTaskId[key] = assertNonEmpty(input.idForKey(key), "decomposition.task.id");
    }
    const now = input.now ?? new Date();
    const tasks = input.proposals.map((proposal) => {
      const evidence = proposal.suggestedEvidence.map((kind) => {
        if (!TASK_EVIDENCE_KINDS.some((candidate) => candidate === kind)) {
          throw new DomainValidationError(`Unsupported suggested evidence kind '${kind}'`);
        }
        return kind as TaskEvidenceKind;
      });
      return new Task({
        id: keyToTaskId[proposal.key]!,
        projectId: input.projectId,
        title: proposal.title,
        description: proposal.description,
        expectedOutcome: proposal.expectedOutcome,
        ownerRole: proposal.ownerRole,
        estimatedEffortHours: assertFiniteNonNegative(
          proposal.estimatedEffortHours,
          "decomposition.task.estimatedEffortHours",
        ),
        impact: proposal.impact,
        riskLevel: proposal.riskLevel,
        verificationRequirements: proposal.verificationRequirements,
        suggestedEvidence: evidence,
        component: proposal.component,
        deadlineCriticality: proposal.deadlineCriticality,
        scopeTier: proposal.scopeTier,
        status: "PLANNED",
        createdAt: now,
        updatedAt: now,
      });
    });
    const dependencies = input.proposals.flatMap((proposal) =>
      proposal.dependencyKeys.map((dependencyKey) => {
        const dependencyTaskId = keyToTaskId[dependencyKey];
        if (dependencyTaskId === undefined) {
          throw new DomainValidationError(
            `Proposed task '${proposal.key}' references unknown dependency '${dependencyKey}'`,
          );
        }
        return new TaskDependency({
          projectId: input.projectId,
          dependencyTaskId,
          dependantTaskId: keyToTaskId[proposal.key]!,
          requiredStatus: "VERIFIED",
          rationale: `Structured decomposition dependency ${dependencyKey} -> ${proposal.key}`,
        });
      }),
    );
    const graph = new TaskGraph(tasks);
    for (const dependency of dependencies) graph.addDependency(dependency);
    return Object.freeze({
      tasks: Object.freeze(tasks),
      dependencies: Object.freeze(dependencies),
      keyToTaskId: Object.freeze({ ...keyToTaskId }),
    });
  }
}
