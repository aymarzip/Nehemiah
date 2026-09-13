import { DomainValidationError } from "../errors.js";
import { assertDate, assertFiniteNonNegative, round, type ProjectMode } from "../domain/common.js";

export type ProjectPhase =
  | "EXPLORATION"
  | "PRODUCTION"
  | "SCOPE_LOCK"
  | "FEATURE_FREEZE"
  | "SHIP_MODE"
  | "DEADLINE_PASSED";
export type DeadlineBufferStatus = "SAFE" | "TIGHT" | "EXHAUSTED";

export interface DeadlineInput {
  deadline: Date;
  now?: Date | undefined;
  projectStartedAt?: Date | undefined;
  mode?: ProjectMode | undefined;
  requiredEffortHours?: number | undefined;
  availableCapacityHours?: number | undefined;
  desiredBufferHours?: number | undefined;
}

export interface DeadlineSnapshot {
  deadline: Date;
  calculatedAt: Date;
  remainingMilliseconds: number;
  remainingHours: number;
  remainingDays: number;
  overdueByHours: number;
  isOverdue: boolean;
  phase: ProjectPhase;
  requiredEffortHours: number;
  availableCapacityHours: number;
  bufferHours: number;
  bufferRatio: number;
  desiredBufferHours: number;
  bufferStatus: DeadlineBufferStatus;
}

export interface DeadlinePolicy {
  standardScopeLockHours: number;
  standardFeatureFreezeHours: number;
  standardShipModeHours: number;
  gameJamScopeLockRemainingRatio: number;
  gameJamExplorationRemainingRatio: number;
  gameJamFeatureFreezeRemainingRatio: number;
  gameJamShipModeRemainingRatio: number;
}

const DEFAULT_POLICY: DeadlinePolicy = Object.freeze({
  standardScopeLockHours: 30 * 24,
  standardFeatureFreezeHours: 14 * 24,
  standardShipModeHours: 3 * 24,
  gameJamScopeLockRemainingRatio: 0.5,
  gameJamExplorationRemainingRatio: 0.9,
  gameJamFeatureFreezeRemainingRatio: 0.25,
  gameJamShipModeRemainingRatio: 0.1,
});

const HOUR_MS = 60 * 60 * 1000;

export class DeadlineService {
  readonly #policy: DeadlinePolicy;

  public constructor(policy: Partial<DeadlinePolicy> = {}) {
    this.#policy = Object.freeze({ ...DEFAULT_POLICY, ...policy });
    const p = this.#policy;
    if (
      p.standardScopeLockHours <= p.standardFeatureFreezeHours ||
      p.standardFeatureFreezeHours <= p.standardShipModeHours ||
      p.standardShipModeHours < 0
    ) {
      throw new DomainValidationError(
        "Standard deadline thresholds must decrease from scope lock to ship mode",
      );
    }
    if (
      p.gameJamScopeLockRemainingRatio <= p.gameJamFeatureFreezeRemainingRatio ||
      p.gameJamExplorationRemainingRatio <= p.gameJamScopeLockRemainingRatio ||
      p.gameJamFeatureFreezeRemainingRatio <= p.gameJamShipModeRemainingRatio ||
      p.gameJamShipModeRemainingRatio < 0 ||
      p.gameJamExplorationRemainingRatio > 1
    ) {
      throw new DomainValidationError(
        "Game jam deadline ratios must decrease from scope lock to ship mode and remain within 0..1",
      );
    }
  }

  public calculate(input: DeadlineInput): DeadlineSnapshot {
    const deadline = assertDate(input.deadline, "deadline");
    const now = assertDate(input.now ?? new Date(), "now");
    const remainingRaw = (deadline.getTime() - now.getTime()) / HOUR_MS;
    const remainingHours = Math.max(0, remainingRaw);
    const overdueByHours = Math.max(0, -remainingRaw);
    const requiredEffortHours = assertFiniteNonNegative(
      input.requiredEffortHours ?? 0,
      "requiredEffortHours",
    );
    const availableCapacityHours = assertFiniteNonNegative(
      input.availableCapacityHours ?? remainingHours,
      "availableCapacityHours",
    );
    const desiredBufferHours = assertFiniteNonNegative(
      input.desiredBufferHours ?? (input.mode === "GAME_JAM" ? 1 : 24),
      "desiredBufferHours",
    );
    const bufferHours = availableCapacityHours - requiredEffortHours;
    const bufferRatio =
      availableCapacityHours === 0
        ? requiredEffortHours === 0
          ? 1
          : -1
        : bufferHours / availableCapacityHours;
    return Object.freeze({
      deadline,
      calculatedAt: now,
      remainingMilliseconds: Math.max(0, deadline.getTime() - now.getTime()),
      remainingHours: round(remainingHours),
      remainingDays: round(remainingHours / 24),
      overdueByHours: round(overdueByHours),
      isOverdue: deadline <= now,
      phase: this.phase({ ...input, deadline, now }),
      requiredEffortHours,
      availableCapacityHours,
      bufferHours: round(bufferHours),
      bufferRatio: round(bufferRatio, 4),
      desiredBufferHours,
      bufferStatus:
        bufferHours < 0 ? "EXHAUSTED" : bufferHours < desiredBufferHours ? "TIGHT" : "SAFE",
    });
  }

  public phase(
    input: Pick<DeadlineInput, "deadline" | "now" | "projectStartedAt" | "mode">,
  ): ProjectPhase {
    const deadline = assertDate(input.deadline, "deadline");
    const now = assertDate(input.now ?? new Date(), "now");
    if (deadline <= now) return "DEADLINE_PASSED";
    const remainingHours = (deadline.getTime() - now.getTime()) / HOUR_MS;
    if ((input.mode ?? "STANDARD") === "GAME_JAM") {
      if (input.projectStartedAt === undefined) {
        throw new DomainValidationError(
          "projectStartedAt is required to calculate a game jam phase",
        );
      }
      const startedAt = assertDate(input.projectStartedAt, "projectStartedAt");
      if (startedAt >= deadline) {
        throw new DomainValidationError("projectStartedAt must precede the deadline");
      }
      const totalHours = (deadline.getTime() - startedAt.getTime()) / HOUR_MS;
      const remainingRatio = remainingHours / totalHours;
      if (remainingRatio > this.#policy.gameJamExplorationRemainingRatio) return "EXPLORATION";
      if (remainingRatio > this.#policy.gameJamScopeLockRemainingRatio) return "PRODUCTION";
      if (remainingRatio > this.#policy.gameJamFeatureFreezeRemainingRatio) return "SCOPE_LOCK";
      if (remainingRatio > this.#policy.gameJamShipModeRemainingRatio) return "FEATURE_FREEZE";
      return "SHIP_MODE";
    }
    if (remainingHours > this.#policy.standardScopeLockHours) return "PRODUCTION";
    if (remainingHours > this.#policy.standardFeatureFreezeHours) return "SCOPE_LOCK";
    if (remainingHours > this.#policy.standardShipModeHours) return "FEATURE_FREEZE";
    return "SHIP_MODE";
  }
}
