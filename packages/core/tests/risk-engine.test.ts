import { describe, expect, it } from "vitest";
import { DomainValidationError, RISK_SIGNAL_CODES, RiskEngine } from "../src/index.js";
import { BASE_TIME, makeTask } from "./factories.js";

const NOW = new Date("2030-01-10T00:00:00.000Z");

describe("RiskEngine", () => {
  it("emits all nine explainable deterministic signals", () => {
    const critical = makeTask("critical", {
      title: "Release build",
      impact: "CRITICAL",
      status: "BLOCKED",
      blockReason: "Signing certificate missing",
      dueAt: new Date("2030-01-09T12:00:00.000Z"),
    });
    const assessment = new RiskEngine().assess({
      projectId: "project-1",
      tasks: [critical],
      criticalPathTaskIds: [critical.id],
      requiredChecks: [
        { name: "unit-tests", status: "FAILED", details: "2 tests failed", taskId: critical.id },
      ],
      highImpactChanges: [
        {
          id: "change-1",
          summary: "Replace persistence layer",
          impact: "CRITICAL",
          reviewed: false,
          taskId: critical.id,
        },
      ],
      deadline: {
        deadline: new Date("2030-01-11T00:00:00.000Z"),
        requiredEffortHours: 100,
        availableCapacityHours: 8,
        minimumBufferHours: 24,
        previousBufferHours: 48,
      },
      buildFreshness: {
        projectStartedAt: BASE_TIME,
        maximumAgeHours: 24,
      },
      scopeHistory: [
        { capturedAt: new Date("2030-01-08T00:00:00.000Z"), unfinishedWeightedEffort: 10 },
        { capturedAt: new Date("2030-01-09T00:00:00.000Z"), unfinishedWeightedEffort: 15 },
      ],
      integrationDependencies: [
        {
          name: "Platform SDK",
          resolved: false,
          taskId: critical.id,
          requiredBy: new Date("2030-01-09T00:00:00.000Z"),
          details: "Vendor approval pending",
        },
      ],
      now: NOW,
    });

    expect(assessment.signals.map((signal) => signal.code)).toEqual(RISK_SIGNAL_CODES);
    expect(assessment.signals.every((signal) => signal.active)).toBe(true);
    expect(assessment.signals.every((signal) => signal.evidence.length > 0)).toBe(true);
    expect(assessment.overallScore).toBe(100);
    expect(assessment.severity).toBe("CRITICAL");
    expect(assessment.risks).toHaveLength(9);
    expect(assessment.risks.every((risk) => risk.id.startsWith("project-1:"))).toBe(true);
  });

  it("does not invent risk when all inputs are healthy", () => {
    const shipped = makeTask("shipped", {
      status: "SHIPPED",
      impact: "CRITICAL",
      ownerId: "owner",
      dueAt: new Date("2030-01-01T00:00:00.000Z"),
    });
    const assessment = new RiskEngine().assess({
      projectId: "project-1",
      tasks: [shipped],
      criticalPathTaskIds: [shipped.id],
      requiredChecks: [{ name: "CI", status: "PASSED" }],
      highImpactChanges: [
        { id: "change", summary: "Reviewed change", impact: "HIGH", reviewed: true },
      ],
      deadline: {
        deadline: new Date("2030-02-01T00:00:00.000Z"),
        requiredEffortHours: 10,
        availableCapacityHours: 100,
        minimumBufferHours: 24,
        previousBufferHours: 80,
      },
      buildFreshness: {
        projectStartedAt: BASE_TIME,
        lastIntegratedBuildAt: new Date("2030-01-09T12:00:00.000Z"),
        maximumAgeHours: 24,
      },
      scopeHistory: [
        { capturedAt: new Date("2030-01-08T00:00:00.000Z"), unfinishedWeightedEffort: 20 },
        { capturedAt: new Date("2030-01-09T00:00:00.000Z"), unfinishedWeightedEffort: 10 },
      ],
      integrationDependencies: [{ name: "Platform SDK", resolved: true }],
      now: NOW,
    });

    expect(assessment.overallScore).toBe(0);
    expect(assessment.severity).toBe("LOW");
    expect(assessment.risks).toEqual([]);
    expect(assessment.signals).toHaveLength(9);
    expect(assessment.signals.every((signal) => !signal.active && signal.contribution === 0)).toBe(
      true,
    );
  });

  it("uses configurable weights and stable severity thresholds", () => {
    const engine = new RiskEngine({ FAILING_REQUIRED_CHECKS: 40 });
    const assessment = engine.assess({
      projectId: "project-1",
      tasks: [],
      requiredChecks: [{ name: "security", status: "FAILED" }],
      now: NOW,
    });

    expect(assessment.overallScore).toBe(40);
    expect(assessment.severity).toBe("HIGH");
    expect(
      assessment.signals.find((signal) => signal.code === "FAILING_REQUIRED_CHECKS")?.weight,
    ).toBe(40);
  });

  it("reports quantitative deadline, build, and scope evidence", () => {
    const assessment = new RiskEngine().assess({
      projectId: "project-1",
      tasks: [],
      deadline: {
        deadline: new Date("2030-01-11T00:00:00.000Z"),
        requiredEffortHours: 30,
        availableCapacityHours: 32,
        minimumBufferHours: 8,
      },
      buildFreshness: { projectStartedAt: BASE_TIME, maximumAgeHours: 48 },
      scopeHistory: [
        { capturedAt: BASE_TIME, unfinishedWeightedEffort: 0 },
        { capturedAt: new Date("2030-01-02T00:00:00.000Z"), unfinishedWeightedEffort: 5 },
      ],
      now: NOW,
    });

    const activeEvidence = assessment.signals
      .filter((signal) => signal.active)
      .flatMap((signal) => signal.evidence);
    expect(activeEvidence.some((line) => line.includes("2 hours"))).toBe(true);
    expect(activeEvidence.some((line) => line.includes("integrated build"))).toBe(true);
    expect(activeEvidence.some((line) => line.includes("100%"))).toBe(true);
  });

  it("is deterministic for identical timestamps and inputs", () => {
    const context = {
      projectId: "project-1",
      tasks: [makeTask("critical", { impact: "CRITICAL" })],
      now: NOW,
    } as const;
    expect(new RiskEngine().assess(context)).toEqual(new RiskEngine().assess(context));
  });

  it("reduces risk when a blocker and failing CI are resolved", () => {
    const engine = new RiskEngine();
    const blocked = makeTask("release", {
      impact: "CRITICAL",
      status: "BLOCKED",
      blockReason: "Signing unavailable",
    });
    const risky = engine.assess({
      projectId: "project-1",
      tasks: [blocked],
      criticalPathTaskIds: [blocked.id],
      requiredChecks: [{ name: "CI", status: "FAILED", taskId: blocked.id }],
      now: NOW,
    });
    const resolved = engine.assess({
      projectId: "project-1",
      tasks: [makeTask("release", { impact: "CRITICAL", status: "VERIFIED" })],
      criticalPathTaskIds: [blocked.id],
      requiredChecks: [{ name: "CI", status: "PASSED", taskId: blocked.id }],
      now: NOW,
    });
    expect(risky.overallScore).toBeGreaterThan(resolved.overallScore);
    expect(resolved.signals.find((signal) => signal.code === "BLOCKED_CRITICAL_TASK")?.active).toBe(
      false,
    );
    expect(
      resolved.signals.find((signal) => signal.code === "FAILING_REQUIRED_CHECKS")?.active,
    ).toBe(false);
  });

  it("rejects invalid weights and cross-project tasks", () => {
    expect(() => new RiskEngine({ BLOCKED_CRITICAL_TASK: -1 })).toThrow(DomainValidationError);
    expect(() =>
      new RiskEngine().assess({
        projectId: "project-1",
        tasks: [makeTask("other", { projectId: "project-2" })],
        now: NOW,
      }),
    ).toThrow(DomainValidationError);
  });
});
