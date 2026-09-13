import { InvalidTaskTransitionError } from "../errors.js";
import { type TaskStatus, type TeamMemberId } from "../domain/common.js";
import type { Task, TaskEvidence, TaskEvidenceKind } from "../domain/task.js";
import type { TaskGraph } from "./task-graph.js";

const statuses = (...values: TaskStatus[]): ReadonlySet<TaskStatus> => new Set(values);

const TRANSITIONS: Readonly<Record<TaskStatus, ReadonlySet<TaskStatus>>> = Object.freeze({
  PLANNED: statuses("READY", "CANCELLED"),
  READY: statuses("IN_PROGRESS", "BLOCKED", "CANCELLED"),
  IN_PROGRESS: statuses("BLOCKED", "IMPLEMENTED", "CANCELLED"),
  BLOCKED: statuses("READY", "IN_PROGRESS", "CANCELLED"),
  IMPLEMENTED: statuses("IN_PROGRESS", "VERIFIED", "BLOCKED", "CANCELLED"),
  VERIFIED: statuses("IN_PROGRESS", "INTEGRATED", "BLOCKED", "CANCELLED"),
  INTEGRATED: statuses("IN_PROGRESS", "SHIPPED", "BLOCKED"),
  SHIPPED: statuses(),
  CANCELLED: statuses(),
});

const IMPLEMENTATION_EVIDENCE: ReadonlySet<TaskEvidenceKind> = new Set([
  "COMMIT",
  "PULL_REQUEST",
  "BUILD",
  "ARTIFACT",
]);
const VERIFICATION_EVIDENCE: ReadonlySet<TaskEvidenceKind> = new Set([
  "REVIEW",
  "CHECK_RUN",
  "TEST_RESULT",
  "MANUAL_VERIFICATION",
]);
const INTEGRATION_EVIDENCE: ReadonlySet<TaskEvidenceKind> = new Set([
  "BUILD",
  "CHECK_RUN",
  "DEPLOYMENT",
]);
const SHIPMENT_EVIDENCE: ReadonlySet<TaskEvidenceKind> = new Set(["DEPLOYMENT", "ARTIFACT"]);

export interface TaskTransitionRequest {
  task: Task;
  to: TaskStatus;
  graph?: TaskGraph | undefined;
  evidence?: readonly TaskEvidence[] | undefined;
  ownerId?: TeamMemberId | undefined;
  blockReason?: string | undefined;
  now?: Date | undefined;
}

export interface TaskTransitionCheck {
  allowed: boolean;
  reasons: readonly string[];
}

export class TaskStateMachine {
  public canTransition(request: TaskTransitionRequest): TaskTransitionCheck {
    const reasons = this.guardFailures(request);
    return { allowed: reasons.length === 0, reasons: Object.freeze(reasons) };
  }

  public transition(request: TaskTransitionRequest): Task {
    const reasons = this.guardFailures(request);
    if (reasons.length > 0) {
      throw new InvalidTaskTransitionError(
        request.task.id,
        request.task.status,
        request.to,
        reasons.join("; "),
      );
    }

    const now = request.now ?? new Date();
    let transitioned = request.task;
    for (const evidence of request.evidence ?? []) {
      transitioned = transitioned.addEvidence(evidence, now);
    }
    const ownerId = request.ownerId ?? transitioned.ownerId;
    return transitioned.with({
      status: request.to,
      ownerId,
      blockReason: request.to === "BLOCKED" ? request.blockReason : undefined,
      updatedAt: now,
    });
  }

  public allowedTargets(status: TaskStatus): readonly TaskStatus[] {
    return Object.freeze([...TRANSITIONS[status]]);
  }

  private guardFailures(request: TaskTransitionRequest): string[] {
    const reasons: string[] = [];
    const { task, to } = request;
    if (!TRANSITIONS[task.status].has(to)) {
      reasons.push(`transition ${task.status} -> ${to} is not in the lifecycle`);
      return reasons;
    }
    const now = request.now ?? new Date();
    if (Number.isNaN(now.getTime())) reasons.push("transition timestamp is invalid");
    if (now < task.updatedAt) reasons.push("transition timestamp cannot precede task.updatedAt");

    if (to === "READY" || to === "IN_PROGRESS") {
      if (request.graph === undefined) {
        reasons.push("a task graph is required to verify dependencies");
      } else if (request.graph.getTask(task.id) === undefined) {
        reasons.push("task does not belong to the supplied graph");
      } else if (!request.graph.dependenciesSatisfied(task.id)) {
        const ids = request.graph
          .unmetDependencies(task.id)
          .map((dependency) => dependency.dependencyTaskId)
          .join(", ");
        reasons.push(`dependencies are not satisfied: ${ids}`);
      }
    }
    if (to === "IN_PROGRESS" && (request.ownerId ?? task.ownerId) === undefined) {
      reasons.push("an owner is required before work can start");
    }
    if (to === "BLOCKED" && (request.blockReason?.trim().length ?? 0) === 0) {
      reasons.push("a block reason is required");
    }

    const evidence = [...task.evidence, ...(request.evidence ?? [])];
    if (to === "IMPLEMENTED" && !this.hasEvidence(evidence, IMPLEMENTATION_EVIDENCE)) {
      reasons.push("implementation evidence is required");
    }
    if (to === "VERIFIED" && !this.hasEvidence(evidence, VERIFICATION_EVIDENCE)) {
      reasons.push("verification evidence is required");
    }
    if (to === "INTEGRATED" && !this.hasEvidence(evidence, INTEGRATION_EVIDENCE)) {
      reasons.push("integration evidence is required");
    }
    if (to === "SHIPPED" && !this.hasEvidence(evidence, SHIPMENT_EVIDENCE)) {
      reasons.push("shipment evidence is required");
    }

    for (const item of request.evidence ?? []) {
      if (item.taskId !== task.id) reasons.push(`evidence '${item.id}' belongs to another task`);
      if (evidence.filter((candidate) => candidate.id === item.id).length > 1) {
        reasons.push(`evidence '${item.id}' is duplicated`);
      }
    }
    return reasons;
  }

  private hasEvidence(
    evidence: readonly TaskEvidence[],
    acceptedKinds: ReadonlySet<TaskEvidenceKind>,
  ): boolean {
    return evidence.some((item) => acceptedKinds.has(item.kind));
  }
}
