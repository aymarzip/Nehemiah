import { round, type TaskId } from "../domain/common.js";
import type { Task, TaskDependency } from "../domain/task.js";
import type { ProjectPhase } from "./deadline-service.js";
import { TaskGraph } from "./task-graph.js";

export interface RepositoryActivity {
  readonly id: string;
  readonly kind: "PUSH" | "PULL_REQUEST" | "REVIEW" | "CHECK" | "ISSUE" | "WORKFLOW";
  readonly taskId?: TaskId | undefined;
  readonly title: string;
  readonly url?: string | undefined;
  readonly branch?: string | undefined;
  readonly state?: string | undefined;
  readonly changedFiles?: readonly string[] | undefined;
  readonly openedAt?: Date | undefined;
  readonly updatedAt: Date;
  readonly reviewed?: boolean | undefined;
  readonly checksPassing?: boolean | undefined;
  readonly merged?: boolean | undefined;
}

export type GitHubFindingCode =
  | "CONTRACT_CHANGE"
  | "INTEGRATION_RISK"
  | "STALE_BLOCKING_PR"
  | "UNVERIFIED_COMPLETION"
  | "LARGE_RISK_CHANGE";

export interface GitHubFinding {
  readonly code: GitHubFindingCode;
  readonly severity: "MEDIUM" | "HIGH" | "CRITICAL";
  readonly title: string;
  readonly explanation: string;
  readonly evidence: readonly string[];
  readonly taskIds: readonly TaskId[];
  readonly activityIds: readonly string[];
  readonly confidence: number;
}

export interface GitHubIntelligenceInput {
  readonly tasks: readonly Task[];
  readonly dependencies?: readonly TaskDependency[] | undefined;
  readonly activities: readonly RepositoryActivity[];
  readonly criticalPathTaskIds?: ReadonlySet<TaskId> | undefined;
  readonly phase: ProjectPhase;
  readonly now?: Date | undefined;
  readonly stalePullRequestHours?: number | undefined;
  readonly broadChangeFileCount?: number | undefined;
}

const active = (task: Task): boolean => !["SHIPPED", "CANCELLED"].includes(task.status);
const contractFile = (file: string): boolean =>
  /(^|\/)(api|contracts?|schemas?|shared|types)(\/|\.|$)|migration/iu.test(file);
const highImpactFile = (file: string): boolean =>
  /(^|\/)(auth|database|migrations?|api|contracts?|schemas?|infra|deploy)(\/|\.|$)/iu.test(file);

export class GitHubIntelligenceService {
  assess(input: GitHubIntelligenceInput): readonly GitHubFinding[] {
    const graph = new TaskGraph(input.tasks, input.dependencies ?? []);
    const tasks = new Map(input.tasks.map((task) => [task.id, task]));
    const findings: GitHubFinding[] = [];
    const now = input.now ?? new Date();
    const staleHours = input.stalePullRequestHours ?? 48;
    const broadCount = input.broadChangeFileCount ?? 20;

    for (const activity of input.activities) {
      const task = activity.taskId === undefined ? undefined : tasks.get(activity.taskId);
      const files = [...new Set(activity.changedFiles ?? [])];
      if (task !== undefined && files.some(contractFile)) {
        const dependants = graph.getDependantTasks(task.id).filter(active);
        if (dependants.length > 0) {
          findings.push(
            Object.freeze({
              code: "CONTRACT_CHANGE",
              severity: dependants.some(
                (candidate) => input.criticalPathTaskIds?.has(candidate.id) === true,
              )
                ? "CRITICAL"
                : "HIGH",
              title: "Shared contract change affects active work",
              explanation: `${activity.title} changes a tracked contract surface while ${dependants.length} dependant task(s) remain active.`,
              evidence: Object.freeze(
                files.filter(contractFile).map((file) => `Changed contract path: ${file}`),
              ),
              taskIds: Object.freeze([task.id, ...dependants.map((candidate) => candidate.id)]),
              activityIds: Object.freeze([activity.id]),
              confidence: 0.85,
            }),
          );
        }
      }
      if (activity.kind === "PULL_REQUEST" && task !== undefined && activity.merged !== true) {
        const openedAt = activity.openedAt ?? activity.updatedAt;
        const ageHours = Math.max(0, (now.getTime() - openedAt.getTime()) / 3_600_000);
        const critical =
          input.criticalPathTaskIds?.has(task.id) === true ||
          task.deadlineCriticality === "CRITICAL";
        if (
          critical &&
          ageHours >= staleHours &&
          (activity.reviewed !== true || activity.checksPassing === false)
        ) {
          findings.push(
            Object.freeze({
              code: "STALE_BLOCKING_PR",
              severity: activity.checksPassing === false ? "CRITICAL" : "HIGH",
              title: "Critical-path pull request is stalled",
              explanation: `${activity.title} has blocked critical work for ${round(ageHours, 1)}h.`,
              evidence: Object.freeze([
                activity.reviewed === true
                  ? "Review is recorded."
                  : "Review approval is not recorded.",
                activity.checksPassing === false
                  ? "Required checks are failing."
                  : "Passing required checks are not recorded.",
              ]),
              taskIds: Object.freeze([task.id]),
              activityIds: Object.freeze([activity.id]),
              confidence: 0.9,
            }),
          );
        }
      }
      const late = input.phase === "FEATURE_FREEZE" || input.phase === "SHIP_MODE";
      if (
        activity.kind === "PULL_REQUEST" &&
        late &&
        (files.length >= broadCount || files.filter(highImpactFile).length >= 3)
      ) {
        findings.push(
          Object.freeze({
            code: "LARGE_RISK_CHANGE",
            severity: input.phase === "SHIP_MODE" ? "CRITICAL" : "HIGH",
            title: "Broad high-impact change late in the project",
            explanation: `${activity.title} changes ${files.length} recorded file(s) during ${input.phase}.`,
            evidence: Object.freeze(
              files
                .filter(highImpactFile)
                .slice(0, 10)
                .map((file) => `High-impact path: ${file}`),
            ),
            taskIds: Object.freeze(task === undefined ? [] : [task.id]),
            activityIds: Object.freeze([activity.id]),
            confidence: files.length > 0 ? 0.8 : 0.5,
          }),
        );
      }
    }

    for (const task of input.tasks) {
      if (["IMPLEMENTED", "VERIFIED", "INTEGRATED", "SHIPPED"].includes(task.status)) {
        const related = input.activities.filter((activity) => activity.taskId === task.id);
        const hasExpected =
          task.suggestedEvidence.length === 0 ||
          task.suggestedEvidence.some((kind) => {
            if (kind === "PULL_REQUEST")
              return related.some((activity) => activity.kind === "PULL_REQUEST");
            if (["CHECK_RUN", "TEST_RESULT", "BUILD"].includes(kind))
              return related.some(
                (activity) => activity.kind === "CHECK" || activity.kind === "WORKFLOW",
              );
            if (kind === "REVIEW")
              return related.some(
                (activity) => activity.kind === "REVIEW" || activity.reviewed === true,
              );
            return task.evidence.some((evidence) => evidence.kind === kind);
          });
        if (!hasExpected) {
          findings.push(
            Object.freeze({
              code: "UNVERIFIED_COMPLETION",
              severity: task.isCritical ? "HIGH" : "MEDIUM",
              title: "Completion lacks expected evidence",
              explanation: `Task '${task.title}' is ${task.status}, but its expected evidence is not recorded.`,
              evidence: Object.freeze(
                task.suggestedEvidence.map((kind) => `Expected evidence: ${kind}`),
              ),
              taskIds: Object.freeze([task.id]),
              activityIds: Object.freeze(related.map((activity) => activity.id)),
              confidence: 0.9,
            }),
          );
        }
      }
    }

    const openChanges = input.activities.filter(
      (activity) =>
        activity.kind === "PULL_REQUEST" &&
        activity.merged !== true &&
        (activity.changedFiles?.length ?? 0) > 0,
    );
    for (let leftIndex = 0; leftIndex < openChanges.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < openChanges.length; rightIndex += 1) {
        const left = openChanges[leftIndex]!;
        const right = openChanges[rightIndex]!;
        if (left.taskId === right.taskId) continue;
        const overlap = (left.changedFiles ?? []).filter((file) =>
          (right.changedFiles ?? []).includes(file),
        );
        if (overlap.length === 0) continue;
        findings.push(
          Object.freeze({
            code: "INTEGRATION_RISK",
            severity: overlap.some(contractFile) ? "HIGH" : "MEDIUM",
            title: "Parallel changes overlap",
            explanation: `${left.title} and ${right.title} modify ${overlap.length} common path(s).`,
            evidence: Object.freeze(
              overlap.slice(0, 10).map((file) => `Both changes touch: ${file}`),
            ),
            taskIds: Object.freeze(
              [left.taskId, right.taskId].filter((id): id is string => id !== undefined),
            ),
            activityIds: Object.freeze([left.id, right.id]),
            confidence: 0.8,
          }),
        );
      }
    }

    const deduplicated = new Map<string, GitHubFinding>();
    findings.forEach((finding) =>
      deduplicated.set(
        `${finding.code}:${[...finding.taskIds].sort().join(",")}:${finding.activityIds.join(",")}`,
        finding,
      ),
    );
    return Object.freeze([...deduplicated.values()]);
  }
}
