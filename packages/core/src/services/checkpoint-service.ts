import type { Blocker } from "../domain/planning.js";
import type { Task } from "../domain/task.js";

export interface CheckpointActivity {
  readonly kind: "PULL_REQUEST_OPENED" | "PULL_REQUEST_MERGED" | "CHECK_FAILED" | "CHECK_PASSED";
  readonly summary: string;
  readonly taskId?: string | undefined;
}

export interface SmartCheckpoint {
  readonly observed: readonly string[];
  readonly questions: readonly {
    readonly key: "BLOCKER" | "PLAN_CHANGED" | "MISSING_EVIDENCE";
    readonly prompt: string;
    readonly choices: readonly string[];
  }[];
}

export class SmartCheckpointService {
  create(input: {
    readonly memberId: string;
    readonly tasks: readonly Task[];
    readonly blockers?: readonly Blocker[] | undefined;
    readonly activity?: readonly CheckpointActivity[] | undefined;
  }): SmartCheckpoint {
    const owned = input.tasks.filter(
      (task) =>
        task.ownerId === input.memberId && task.status !== "CANCELLED" && task.status !== "SHIPPED",
    );
    const activity = input.activity ?? [];
    const openBlocker = (input.blockers ?? []).some(
      (blocker) =>
        blocker.status === "OPEN" &&
        (blocker.blockedMemberId === input.memberId ||
          owned.some((task) => task.id === blocker.blockedTaskId)),
    );
    const observed = activity.map((entry) => entry.summary);
    const questions: SmartCheckpoint["questions"][number][] = [];
    if (!openBlocker) {
      questions.push({
        key: "BLOCKER",
        prompt: "Do you currently have a blocker that is not recorded?",
        choices: ["No", "Yes", "Plans changed"],
      });
    }
    if (
      owned.some(
        (task) => task.status === "IMPLEMENTED" && task.verificationRequirements.length > 0,
      )
    ) {
      questions.push({
        key: "MISSING_EVIDENCE",
        prompt: "Implementation is recorded. Is the required verification now available?",
        choices: ["Not yet", "Add evidence", "Plans changed"],
      });
    }
    if (activity.length === 0 && owned.length > 0) {
      questions.push({
        key: "PLAN_CHANGED",
        prompt: "No new repository activity is visible. Did the plan change?",
        choices: ["No", "Yes", "Blocked"],
      });
    }
    return Object.freeze({
      observed: Object.freeze(observed),
      questions: Object.freeze(questions),
    });
  }
}
