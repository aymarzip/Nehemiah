export class DomainError extends Error {
  public constructor(
    message: string,
    public readonly code: string,
    public readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class DomainValidationError extends DomainError {
  public constructor(message: string, details: Readonly<Record<string, unknown>> = {}) {
    super(message, "DOMAIN_VALIDATION_FAILED", details);
  }
}

export class EntityNotFoundError extends DomainError {
  public constructor(entity: string, id: string) {
    super(`${entity} '${id}' was not found`, "ENTITY_NOT_FOUND", { entity, id });
  }
}

export class DuplicateEntityError extends DomainError {
  public constructor(entity: string, id: string) {
    super(`${entity} '${id}' already exists`, "DUPLICATE_ENTITY", { entity, id });
  }
}

export class InvalidTaskTransitionError extends DomainError {
  public constructor(taskId: string, from: string, to: string, reason?: string) {
    super(
      `Task '${taskId}' cannot transition from ${from} to ${to}${reason === undefined ? "" : `: ${reason}`}`,
      "INVALID_TASK_TRANSITION",
      { taskId, from, to, reason },
    );
  }
}

export class CycleDetectedError extends DomainError {
  public constructor(cycle: readonly string[]) {
    super(`Task dependency cycle detected: ${cycle.join(" -> ")}`, "TASK_GRAPH_CYCLE", { cycle });
  }
}

export class PermissionDeniedError extends DomainError {
  public constructor(memberId: string, permission: string) {
    super(`Member '${memberId}' does not have permission '${permission}'`, "PERMISSION_DENIED", {
      memberId,
      permission,
    });
  }
}
