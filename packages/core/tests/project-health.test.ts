import { describe, expect, it } from "vitest";
import { DomainValidationError, ProjectHealthService } from "../src/index.js";
import { makeTask } from "./factories.js";

const service = new ProjectHealthService();

describe("ProjectHealthService", () => {
  it("weights task progress by impact rather than task count", () => {
    const health = service.calculate("project-1", [
      makeTask("minor", { impact: "LOW", status: "SHIPPED" }),
      makeTask("core", { impact: "CRITICAL", status: "PLANNED" }),
    ]);

    expect(health.dimensions.IMPLEMENTATION.score).toBe(23.08);
    expect(health.dimensions.IMPLEMENTATION.score).not.toBe(50);
    expect(health.overallScore).toBe(23.08);
    expect(health.rating).toBe("AT_RISK");
  });

  it("keeps implementation, verification, integration, and release independent", () => {
    const health = service.calculate("project-1", [makeTask("task", { status: "IMPLEMENTED" })]);

    expect(health.dimensions.IMPLEMENTATION.score).toBe(100);
    expect(health.dimensions.VERIFICATION.score).toBe(15);
    expect(health.dimensions.INTEGRATION.score).toBe(5);
    expect(health.dimensions.RELEASE_READINESS.score).toBe(0);
    expect(health.overallScore).toBe(40);
  });

  it("applies custom task weight in addition to criticality", () => {
    const health = service.calculate("project-1", [
      makeTask("done", { status: "SHIPPED", impact: "MEDIUM", weight: 1 }),
      makeTask("pending", { status: "PLANNED", impact: "MEDIUM", weight: 3 }),
    ]);

    expect(health.dimensions.IMPLEMENTATION.totalWeight).toBe(4);
    expect(health.dimensions.IMPLEMENTATION.completedWeight).toBe(1);
    expect(health.dimensions.IMPLEMENTATION.score).toBe(25);
  });

  it("excludes cancelled work and non-release tasks from the relevant denominators", () => {
    const health = service.calculate("project-1", [
      makeTask("cancelled", { status: "CANCELLED", impact: "CRITICAL" }),
      makeTask("internal", { status: "VERIFIED", releaseRequired: false }),
      makeTask("release", { status: "INTEGRATED", releaseRequired: true }),
    ]);

    expect(
      health.dimensions.IMPLEMENTATION.contributions.some((item) => item.taskId === "cancelled"),
    ).toBe(false);
    expect(health.dimensions.RELEASE_READINESS.contributions.map((item) => item.taskId)).toEqual([
      "release",
    ]);
    expect(health.dimensions.RELEASE_READINESS.score).toBe(50);
  });

  it("reports a fully shipped project as ready", () => {
    const health = service.calculate("project-1", [
      makeTask("a", { status: "SHIPPED", impact: "LOW" }),
      makeTask("b", { status: "SHIPPED", impact: "CRITICAL" }),
    ]);

    expect(Object.values(health.dimensions).every((dimension) => dimension.score === 100)).toBe(
      true,
    );
    expect(health.overallScore).toBe(100);
    expect(health.rating).toBe("READY");
  });

  it("does not claim progress for a project with no scoped tasks", () => {
    const health = service.calculate("project-1", []);
    expect(health.overallScore).toBe(0);
    expect(health.rating).toBe("NOT_STARTED");
  });

  it("rejects tasks from another project", () => {
    expect(() =>
      service.calculate("project-1", [makeTask("foreign", { projectId: "project-2" })]),
    ).toThrow(DomainValidationError);
  });
});
