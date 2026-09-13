export type NotificationPriority = "LOW" | "NORMAL" | "HIGH" | "CRITICAL";

export interface ProjectNotification {
  readonly id: string;
  readonly kind:
    | "BLOCKER_CREATED"
    | "CRITICAL_PATH_CHANGED"
    | "DEADLINE_RISK_CHANGED"
    | "ASSIGNMENT"
    | "REVIEW_REQUESTED"
    | "SCOPE_FREEZE"
    | "INTEGRATION_RISK"
    | "CHECKPOINT_SUMMARY";
  readonly priority: NotificationPriority;
  readonly deduplicationKey: string;
  readonly summary: string;
  readonly occurredAt: Date;
}

export interface NotificationPlan {
  readonly immediate: readonly ProjectNotification[];
  readonly batched: readonly ProjectNotification[];
  readonly suppressed: readonly ProjectNotification[];
}

export class NotificationPolicyService {
  plan(
    notifications: readonly ProjectNotification[],
    policy: "IMMEDIATE_CRITICAL" | "BATCHED" | "CHECKPOINT_ONLY",
  ): NotificationPlan {
    const newest = new Map<string, ProjectNotification>();
    const suppressed: ProjectNotification[] = [];
    [...notifications]
      .sort((left, right) => right.occurredAt.getTime() - left.occurredAt.getTime())
      .forEach((notification) => {
        if (newest.has(notification.deduplicationKey)) suppressed.push(notification);
        else newest.set(notification.deduplicationKey, notification);
      });
    const values = [...newest.values()].sort(
      (left, right) => left.occurredAt.getTime() - right.occurredAt.getTime(),
    );
    if (policy === "CHECKPOINT_ONLY") {
      return Object.freeze({
        immediate: Object.freeze([]),
        batched: Object.freeze(values),
        suppressed: Object.freeze(suppressed),
      });
    }
    const urgent = values.filter(
      (notification) =>
        notification.priority === "CRITICAL" ||
        (notification.priority === "HIGH" &&
          ["BLOCKER_CREATED", "DEADLINE_RISK_CHANGED", "INTEGRATION_RISK"].includes(
            notification.kind,
          )),
    );
    const immediate =
      policy === "IMMEDIATE_CRITICAL"
        ? urgent
        : values.filter((notification) => notification.priority === "CRITICAL");
    const immediateIds = new Set(immediate.map((notification) => notification.id));
    return Object.freeze({
      immediate: Object.freeze(immediate),
      batched: Object.freeze(values.filter((notification) => !immediateIds.has(notification.id))),
      suppressed: Object.freeze(suppressed),
    });
  }
}
