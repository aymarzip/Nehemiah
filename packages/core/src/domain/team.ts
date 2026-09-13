import { DomainValidationError } from "../errors.js";
import {
  assertFiniteNonNegative,
  assertNonEmpty,
  type ProjectId,
  type RoleId,
  type TeamMemberId,
  type WorkspaceId,
} from "./common.js";

export const PERMISSIONS = [
  "PROJECT_VIEW",
  "PROJECT_MANAGE",
  "TEAM_MANAGE",
  "TASK_CREATE",
  "TASK_ASSIGN",
  "TASK_UPDATE_ANY",
  "TASK_UPDATE_OWN",
  "TASK_CANCEL",
  "DECISION_RECORD",
  "CHECKPOINT_MANAGE",
  "INTEGRATION_MANAGE",
  "RISK_ACKNOWLEDGE",
  "PRODUCER_ASK",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export interface RoleInput {
  id: RoleId;
  name: string;
  permissions?: readonly Permission[] | undefined;
  description?: string | undefined;
}

export class Role {
  public readonly id: RoleId;
  public readonly name: string;
  public readonly permissions: ReadonlySet<Permission>;
  public readonly description: string;

  public constructor(input: RoleInput) {
    this.id = assertNonEmpty(input.id, "role.id");
    this.name = assertNonEmpty(input.name, "role.name");
    this.permissions = new Set(input.permissions ?? []);
    this.description = input.description?.trim() ?? "";
    Object.freeze(this);
  }

  public allows(permission: Permission): boolean {
    return this.permissions.has(permission);
  }
}

export type SkillLevel = 1 | 2 | 3 | 4 | 5;

export interface SkillInput {
  name: string;
  level: SkillLevel;
  tags?: readonly string[] | undefined;
}

export class Skill {
  public readonly name: string;
  public readonly level: SkillLevel;
  public readonly tags: readonly string[];

  public constructor(input: SkillInput) {
    this.name = assertNonEmpty(input.name, "skill.name");
    if (!Number.isInteger(input.level) || input.level < 1 || input.level > 5) {
      throw new DomainValidationError("skill.level must be an integer from 1 to 5", {
        level: input.level,
      });
    }
    this.level = input.level;
    this.tags = Object.freeze(
      (input.tags ?? []).map((tag, index) => assertNonEmpty(tag, `skill.tags[${index}]`)),
    );
    Object.freeze(this);
  }
}

export interface AvailabilityWindow {
  dayOfWeek: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  startMinute: number;
  endMinute: number;
}

export interface AvailabilityInput {
  timezone: string;
  weeklyHours: number;
  windows?: readonly AvailabilityWindow[] | undefined;
  unavailableUntil?: Date | undefined;
}

export class Availability {
  public readonly timezone: string;
  public readonly weeklyHours: number;
  public readonly windows: readonly Readonly<AvailabilityWindow>[];
  public readonly unavailableUntil?: Date | undefined;

  public constructor(input: AvailabilityInput) {
    this.timezone = assertNonEmpty(input.timezone, "availability.timezone");
    this.weeklyHours = assertFiniteNonNegative(input.weeklyHours, "availability.weeklyHours");
    if (this.weeklyHours > 168) {
      throw new DomainValidationError("availability.weeklyHours cannot exceed 168");
    }
    this.windows = Object.freeze(
      (input.windows ?? []).map((window, index) => {
        if (
          !Number.isInteger(window.dayOfWeek) ||
          !Number.isInteger(window.startMinute) ||
          !Number.isInteger(window.endMinute) ||
          window.startMinute < 0 ||
          window.endMinute > 1440 ||
          window.startMinute >= window.endMinute
        ) {
          throw new DomainValidationError(`availability.windows[${index}] is invalid`, { window });
        }
        return Object.freeze({ ...window });
      }),
    );
    this.unavailableUntil =
      input.unavailableUntil === undefined ? undefined : new Date(input.unavailableUntil.getTime());
    if (this.unavailableUntil !== undefined && Number.isNaN(this.unavailableUntil.getTime())) {
      throw new DomainValidationError("availability.unavailableUntil must be a valid date");
    }
    Object.freeze(this);
  }

  public isAvailableAt(at: Date): boolean {
    return (
      this.weeklyHours > 0 && (this.unavailableUntil === undefined || at >= this.unavailableUntil)
    );
  }
}

export type CommunicationStyle = "CONCISE" | "DETAILED" | "VISUAL" | "CONVERSATIONAL";

export interface CommunicationPreferencesInput {
  style?: CommunicationStyle | undefined;
  allowDirectMessages?: boolean | undefined;
  mentionForUrgentOnly?: boolean | undefined;
  preferredLanguage?: string | undefined;
  quietHours?: { startMinute: number; endMinute: number } | undefined;
  notificationFrequency?: "IMMEDIATE" | "BATCHED" | "CHECKPOINT_ONLY" | undefined;
  deliveryPreference?: "DM" | "CHANNEL" | "EITHER" | undefined;
  feedbackStyle?: "DIRECT" | "SUPPORTIVE" | "NEUTRAL" | undefined;
  taskPresentation?: "ONE_AT_A_TIME" | "SHORTLIST" | "FULL_QUEUE" | undefined;
}

export class CommunicationPreferences {
  public readonly style: CommunicationStyle;
  public readonly allowDirectMessages: boolean;
  public readonly mentionForUrgentOnly: boolean;
  public readonly preferredLanguage: string;
  public readonly quietHours?: Readonly<{ startMinute: number; endMinute: number }> | undefined;
  public readonly notificationFrequency: "IMMEDIATE" | "BATCHED" | "CHECKPOINT_ONLY";
  public readonly deliveryPreference: "DM" | "CHANNEL" | "EITHER";
  public readonly feedbackStyle: "DIRECT" | "SUPPORTIVE" | "NEUTRAL";
  public readonly taskPresentation: "ONE_AT_A_TIME" | "SHORTLIST" | "FULL_QUEUE";

  public constructor(input: CommunicationPreferencesInput = {}) {
    this.style = input.style ?? "CONCISE";
    this.allowDirectMessages = input.allowDirectMessages ?? true;
    this.mentionForUrgentOnly = input.mentionForUrgentOnly ?? false;
    this.preferredLanguage = assertNonEmpty(input.preferredLanguage ?? "en", "preferredLanguage");
    this.notificationFrequency = input.notificationFrequency ?? "BATCHED";
    this.deliveryPreference = input.deliveryPreference ?? "EITHER";
    this.feedbackStyle = input.feedbackStyle ?? "NEUTRAL";
    this.taskPresentation = input.taskPresentation ?? "SHORTLIST";
    if (input.quietHours !== undefined) {
      const { startMinute, endMinute } = input.quietHours;
      if (
        !Number.isInteger(startMinute) ||
        !Number.isInteger(endMinute) ||
        startMinute < 0 ||
        startMinute >= 1440 ||
        endMinute < 0 ||
        endMinute >= 1440 ||
        startMinute === endMinute
      ) {
        throw new DomainValidationError("communication quiet hours are invalid");
      }
      this.quietHours = Object.freeze({ startMinute, endMinute });
    }
    Object.freeze(this);
  }
}

export interface AITool {
  name: string;
  capabilities: readonly string[];
}

export type AIAutonomyLevel = "ASSISTED" | "SUPERVISED" | "AUTONOMOUS";

export interface AIToolProfileInput {
  tools?: readonly AITool[] | undefined;
  autonomyLevel?: AIAutonomyLevel | undefined;
  notes?: string | undefined;
}

export class AIToolProfile {
  public readonly tools: readonly Readonly<AITool>[];
  public readonly autonomyLevel: AIAutonomyLevel;
  public readonly notes: string;

  public constructor(input: AIToolProfileInput = {}) {
    this.tools = Object.freeze(
      (input.tools ?? []).map((tool, index) =>
        Object.freeze({
          name: assertNonEmpty(tool.name, `aiTools[${index}].name`),
          capabilities: Object.freeze(
            tool.capabilities.map((capability, capabilityIndex) =>
              assertNonEmpty(capability, `aiTools[${index}].capabilities[${capabilityIndex}]`),
            ),
          ),
        }),
      ),
    );
    this.autonomyLevel = input.autonomyLevel ?? "ASSISTED";
    this.notes = input.notes?.trim() ?? "";
    Object.freeze(this);
  }
}

export type TeamMemberStatus = "ACTIVE" | "AWAY" | "INACTIVE";

export interface TeamMemberInput {
  id: TeamMemberId;
  workspaceId: WorkspaceId;
  projectIds?: readonly ProjectId[] | undefined;
  displayName: string;
  externalIdentity?: Readonly<{ source: string; externalId: string }> | undefined;
  roles?: readonly Role[] | undefined;
  skills?: readonly Skill[] | undefined;
  availability: Availability;
  communicationPreferences?: CommunicationPreferences | undefined;
  aiToolProfile?: AIToolProfile | undefined;
  status?: TeamMemberStatus | undefined;
}

export class TeamMember {
  public readonly id: TeamMemberId;
  public readonly workspaceId: WorkspaceId;
  public readonly projectIds: readonly ProjectId[];
  public readonly displayName: string;
  public readonly externalIdentity?: Readonly<{ source: string; externalId: string }> | undefined;
  public readonly roles: readonly Role[];
  public readonly skills: readonly Skill[];
  public readonly availability: Availability;
  public readonly communicationPreferences: CommunicationPreferences;
  public readonly aiToolProfile: AIToolProfile;
  public readonly status: TeamMemberStatus;

  public constructor(input: TeamMemberInput) {
    this.id = assertNonEmpty(input.id, "teamMember.id");
    this.workspaceId = assertNonEmpty(input.workspaceId, "teamMember.workspaceId");
    this.projectIds = Object.freeze([...new Set(input.projectIds ?? [])]);
    this.displayName = assertNonEmpty(input.displayName, "teamMember.displayName");
    this.externalIdentity =
      input.externalIdentity === undefined
        ? undefined
        : Object.freeze({
            source: assertNonEmpty(input.externalIdentity.source, "externalIdentity.source"),
            externalId: assertNonEmpty(
              input.externalIdentity.externalId,
              "externalIdentity.externalId",
            ),
          });
    this.roles = Object.freeze([...(input.roles ?? [])]);
    this.skills = Object.freeze([...(input.skills ?? [])]);
    this.availability = input.availability;
    this.communicationPreferences =
      input.communicationPreferences ?? new CommunicationPreferences();
    this.aiToolProfile = input.aiToolProfile ?? new AIToolProfile();
    this.status = input.status ?? "ACTIVE";
    Object.freeze(this);
  }

  public hasPermission(permission: Permission): boolean {
    return this.roles.some((role) => role.allows(permission));
  }

  public skillLevel(skillName: string): SkillLevel | undefined {
    return this.skills.find(
      (skill) => skill.name.localeCompare(skillName, undefined, { sensitivity: "accent" }) === 0,
    )?.level;
  }
}
