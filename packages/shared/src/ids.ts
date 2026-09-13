import { randomUUID } from "node:crypto";

declare const brand: unique symbol;

export type Brand<Value, Name extends string> = Value & { readonly [brand]: Name };

export type WorkspaceId = Brand<string, "WorkspaceId">;
export type ProjectId = Brand<string, "ProjectId">;
export type MilestoneId = Brand<string, "MilestoneId">;
export type TeamMemberId = Brand<string, "TeamMemberId">;
export type TaskId = Brand<string, "TaskId">;
export type EvidenceId = Brand<string, "EvidenceId">;
export type DecisionId = Brand<string, "DecisionId">;
export type RiskId = Brand<string, "RiskId">;
export type CheckpointId = Brand<string, "CheckpointId">;
export type IntegrationId = Brand<string, "IntegrationId">;
export type EventId = Brand<string, "EventId">;
export type MemoryEntryId = Brand<string, "MemoryEntryId">;

export function createId<Id extends string>(): Id {
  return randomUUID() as Id;
}

export function asId<Id extends string>(value: string, label = "id"): Id {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new TypeError(`${label} must not be empty`);
  }
  return normalized as Id;
}
