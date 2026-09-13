import { DomainValidationError } from "../errors.js";
import { round, type ProjectId, type TaskId, type TaskStatus } from "../domain/common.js";
import type { Task } from "../domain/task.js";

export const PROJECT_HEALTH_DIMENSIONS = [
  "IMPLEMENTATION",
  "VERIFICATION",
  "INTEGRATION",
  "RELEASE_READINESS",
] as const;

export type ProjectHealthDimensionName = (typeof PROJECT_HEALTH_DIMENSIONS)[number];
export type ProjectHealthRating = "NOT_STARTED" | "AT_RISK" | "DEVELOPING" | "ON_TRACK" | "READY";

export interface ProjectHealthTaskContribution {
  taskId: TaskId;
  title: string;
  impactWeight: number;
  completion: number;
  contribution: number;
}

export interface ProjectHealthDimension {
  name: ProjectHealthDimensionName;
  score: number;
  completedWeight: number;
  totalWeight: number;
  contributions: readonly ProjectHealthTaskContribution[];
}

export interface ProjectHealthAssessment {
  projectId: ProjectId;
  overallScore: number;
  rating: ProjectHealthRating;
  dimensions: Readonly<Record<ProjectHealthDimensionName, ProjectHealthDimension>>;
}

const COMPLETION: Readonly<
  Record<ProjectHealthDimensionName, Readonly<Record<TaskStatus, number>>>
> = Object.freeze({
  IMPLEMENTATION: Object.freeze({
    PLANNED: 0,
    READY: 0,
    IN_PROGRESS: 0.5,
    BLOCKED: 0,
    IMPLEMENTED: 1,
    VERIFIED: 1,
    INTEGRATED: 1,
    SHIPPED: 1,
    CANCELLED: 0,
  }),
  VERIFICATION: Object.freeze({
    PLANNED: 0,
    READY: 0,
    IN_PROGRESS: 0,
    BLOCKED: 0,
    IMPLEMENTED: 0.15,
    VERIFIED: 1,
    INTEGRATED: 1,
    SHIPPED: 1,
    CANCELLED: 0,
  }),
  INTEGRATION: Object.freeze({
    PLANNED: 0,
    READY: 0,
    IN_PROGRESS: 0,
    BLOCKED: 0,
    IMPLEMENTED: 0.05,
    VERIFIED: 0.25,
    INTEGRATED: 1,
    SHIPPED: 1,
    CANCELLED: 0,
  }),
  RELEASE_READINESS: Object.freeze({
    PLANNED: 0,
    READY: 0,
    IN_PROGRESS: 0,
    BLOCKED: 0,
    IMPLEMENTED: 0,
    VERIFIED: 0.1,
    INTEGRATED: 0.5,
    SHIPPED: 1,
    CANCELLED: 0,
  }),
});

const DIMENSION_WEIGHTS: Readonly<Record<ProjectHealthDimensionName, number>> = Object.freeze({
  IMPLEMENTATION: 0.35,
  VERIFICATION: 0.25,
  INTEGRATION: 0.25,
  RELEASE_READINESS: 0.15,
});

export class ProjectHealthService {
  public calculate(projectId: ProjectId, tasks: readonly Task[]): ProjectHealthAssessment {
    for (const task of tasks) {
      if (task.projectId !== projectId) {
        throw new DomainValidationError(
          "Project health cannot include tasks from another project",
          {
            projectId,
            taskId: task.id,
          },
        );
      }
    }
    const dimensions = Object.fromEntries(
      PROJECT_HEALTH_DIMENSIONS.map((dimension) => [
        dimension,
        this.calculateDimension(dimension, tasks),
      ]),
    ) as unknown as Record<ProjectHealthDimensionName, ProjectHealthDimension>;
    const overallScore = round(
      PROJECT_HEALTH_DIMENSIONS.reduce(
        (total, dimension) => total + dimensions[dimension].score * DIMENSION_WEIGHTS[dimension],
        0,
      ),
    );
    return Object.freeze({
      projectId,
      overallScore,
      rating: this.rating(overallScore),
      dimensions: Object.freeze(dimensions),
    });
  }

  private calculateDimension(
    dimension: ProjectHealthDimensionName,
    tasks: readonly Task[],
  ): ProjectHealthDimension {
    const included = tasks.filter(
      (task) =>
        task.status !== "CANCELLED" && (dimension !== "RELEASE_READINESS" || task.releaseRequired),
    );
    const contributions = included.map((task): ProjectHealthTaskContribution => {
      const impactWeight = task.impactWeight * task.weight;
      const completion = COMPLETION[dimension][task.status];
      return Object.freeze({
        taskId: task.id,
        title: task.title,
        impactWeight: round(impactWeight),
        completion,
        contribution: round(impactWeight * completion),
      });
    });
    const totalWeight = contributions.reduce((total, item) => total + item.impactWeight, 0);
    const completedWeight = contributions.reduce((total, item) => total + item.contribution, 0);
    return Object.freeze({
      name: dimension,
      score: totalWeight === 0 ? 0 : round((completedWeight / totalWeight) * 100),
      completedWeight: round(completedWeight),
      totalWeight: round(totalWeight),
      contributions: Object.freeze(contributions),
    });
  }

  private rating(score: number): ProjectHealthRating {
    if (score >= 95) return "READY";
    if (score >= 70) return "ON_TRACK";
    if (score >= 35) return "DEVELOPING";
    if (score > 0) return "AT_RISK";
    return "NOT_STARTED";
  }
}
