import { DomainValidationError } from "../errors.js";

export type WorkspaceId = string;
export type ProjectId = string;
export type MilestoneId = string;
export type TeamMemberId = string;
export type RoleId = string;
export type TaskId = string;
export type DecisionId = string;
export type RiskId = string;
export type IntegrationId = string;
export type ProjectEventId = string;
export type ProjectCheckpointId = string;
export type MemoryEntryId = string;

export type ProjectMode = "STANDARD" | "GAME_JAM";
export type ProjectStatus = "DRAFT" | "ACTIVE" | "PAUSED" | "COMPLETED" | "CANCELLED";
export type Impact = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export const TASK_STATUSES = [
  "PLANNED",
  "READY",
  "IN_PROGRESS",
  "BLOCKED",
  "IMPLEMENTED",
  "VERIFIED",
  "INTEGRATED",
  "SHIPPED",
  "CANCELLED",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TERMINAL_TASK_STATUSES: ReadonlySet<TaskStatus> = new Set(["SHIPPED", "CANCELLED"]);
export const COMPLETED_TASK_STATUSES: ReadonlySet<TaskStatus> = new Set([
  "IMPLEMENTED",
  "VERIFIED",
  "INTEGRATED",
  "SHIPPED",
]);

export const IMPACT_WEIGHTS: Readonly<Record<Impact, number>> = Object.freeze({
  LOW: 0.75,
  MEDIUM: 1,
  HIGH: 1.75,
  CRITICAL: 2.5,
});

export function assertNonEmpty(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new DomainValidationError(`${field} must not be empty`, { field });
  }
  return normalized;
}

export function assertFiniteNonNegative(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new DomainValidationError(`${field} must be a finite non-negative number`, {
      field,
      value,
    });
  }
  return value;
}

export function assertPositive(value: number, field: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new DomainValidationError(`${field} must be a finite positive number`, { field, value });
  }
  return value;
}

export function assertDate(value: Date, field: string): Date {
  if (Number.isNaN(value.getTime())) {
    throw new DomainValidationError(`${field} must be a valid date`, { field });
  }
  return new Date(value.getTime());
}

export function freezeDate(value: Date): Date {
  return new Date(value.getTime());
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function round(value: number, precision = 2): number {
  const factor = 10 ** precision;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function exhaustive(value: never): never {
  throw new DomainValidationError(`Unsupported value: ${String(value)}`);
}
