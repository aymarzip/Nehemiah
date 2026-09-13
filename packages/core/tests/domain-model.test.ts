import { describe, expect, it } from "vitest";
import {
  AIToolProfile,
  Availability,
  CommunicationPreferences,
  Decision,
  DomainValidationError,
  Integration,
  Milestone,
  ProjectCheckpoint,
  ProjectEvent,
  ProjectMemory,
  ProjectMemoryEntry,
  ProjectVision,
  Risk,
  Role,
  Skill,
  TaskDependency,
  TeamMember,
  Workspace,
} from "../src/index.js";
import { BASE_TIME, makeProject, makeTask } from "./factories.js";

describe("core domain model", () => {
  it("models project vision, workspace membership, project mode, and milestones", () => {
    const vision = new ProjectVision({
      statement: "Deliver a playable cooperative demo",
      successCriteria: ["Two players can complete a round"],
      nonGoals: ["Online matchmaking"],
    });
    const workspace = new Workspace({
      id: "workspace-1",
      name: "Jam Team",
      ownerId: "lead",
      memberIds: ["lead", "developer"],
      createdAt: BASE_TIME,
    });
    const expanded = workspace.withMember("artist", new Date(BASE_TIME.getTime() + 1));
    const project = makeProject({ vision, mode: "GAME_JAM" });
    const milestone = new Milestone({
      id: "milestone-1",
      projectId: project.id,
      name: "Playable",
      dueAt: new Date("2030-01-15T00:00:00.000Z"),
      taskIds: ["a", "b"],
      completionCriteria: ["Build launches"],
    });

    expect(vision.statement).toBe("Deliver a playable cooperative demo");
    expect(workspace.memberIds).toEqual(["lead", "developer"]);
    expect(expanded.memberIds).toEqual(["lead", "developer", "artist"]);
    expect(project.mode).toBe("GAME_JAM");
    expect(milestone.completionRatio(new Set(["a"]))).toBe(0.5);
  });

  it("validates project and milestone invariants", () => {
    expect(() => new ProjectVision({ statement: " " })).toThrow(DomainValidationError);
    expect(() => makeProject({ deadline: new Date("2029-12-31T00:00:00.000Z") })).toThrow(
      DomainValidationError,
    );
    expect(
      () =>
        new Milestone({
          id: "m",
          projectId: "project-1",
          name: " ",
          dueAt: BASE_TIME,
        }),
    ).toThrow(DomainValidationError);
  });

  it("models member skills, availability, communication, roles, and AI tools", () => {
    const role = new Role({
      id: "developer",
      name: "Developer",
      permissions: ["TASK_UPDATE_OWN", "PRODUCER_ASK"],
    });
    const skill = new Skill({ name: "TypeScript", level: 4, tags: ["backend"] });
    const availability = new Availability({
      timezone: "Europe/Kyiv",
      weeklyHours: 30,
      windows: [{ dayOfWeek: 1, startMinute: 9 * 60, endMinute: 17 * 60 }],
    });
    const communication = new CommunicationPreferences({
      style: "DETAILED",
      preferredLanguage: "uk",
      quietHours: { startMinute: 22 * 60, endMinute: 8 * 60 },
    });
    const aiTools = new AIToolProfile({
      autonomyLevel: "SUPERVISED",
      tools: [{ name: "Codex", capabilities: ["coding", "review"] }],
    });
    const member = new TeamMember({
      id: "member",
      workspaceId: "workspace-1",
      projectIds: ["project-1"],
      displayName: "Ada",
      roles: [role],
      skills: [skill],
      availability,
      communicationPreferences: communication,
      aiToolProfile: aiTools,
    });

    expect(member.hasPermission("TASK_UPDATE_OWN")).toBe(true);
    expect(member.skillLevel("typescript")).toBe(4);
    expect(member.availability.isAvailableAt(BASE_TIME)).toBe(true);
    expect(member.communicationPreferences.style).toBe("DETAILED");
    expect(member.aiToolProfile.tools[0]?.name).toBe("Codex");
    expect(() => new Skill({ name: "Invalid", level: 6 as never })).toThrow(DomainValidationError);
    expect(
      () =>
        new Availability({
          timezone: "UTC",
          weeklyHours: 10,
          windows: [{ dayOfWeek: 1, startMinute: 600, endMinute: 500 }],
        }),
    ).toThrow(DomainValidationError);
  });

  it("validates task dependencies as first-class domain entities", () => {
    const dependency = new TaskDependency({
      projectId: "project-1",
      dependencyTaskId: "design",
      dependantTaskId: "implementation",
      rationale: "Implementation needs an approved design",
    });
    expect(dependency.id).toBe("design->implementation");
    expect(dependency.requiredStatus).toBe("VERIFIED");
    expect(
      () =>
        new TaskDependency({
          projectId: "project-1",
          dependencyTaskId: "same",
          dependantTaskId: "same",
        }),
    ).toThrow(DomainValidationError);
  });

  it("models decisions, risks, checkpoints, integrations, and typed project events", () => {
    const decision = new Decision({
      id: "decision-1",
      projectId: "project-1",
      title: "Use a modular monolith",
      context: "The team is small",
      outcome: "One deployable with bounded packages",
      status: "ACCEPTED",
      decidedAt: BASE_TIME,
    });
    const risk = new Risk({
      id: "risk-1",
      projectId: "project-1",
      signal: "CI_FAILURE",
      title: "Required CI is failing",
      severity: "HIGH",
      weight: 12,
      scoreContribution: 12,
      evidence: ["unit-tests failed"],
      affectedTaskIds: ["task-1"],
      detectedAt: BASE_TIME,
    });
    const checkpoint = new ProjectCheckpoint({
      id: "checkpoint-1",
      projectId: "project-1",
      name: "Feature freeze",
      kind: "FEATURE_FREEZE",
      dueAt: BASE_TIME,
      status: "PASSED",
      completedAt: BASE_TIME,
    });
    const integration = new Integration({
      id: "integration-1",
      projectId: "project-1",
      kind: "GITHUB",
      name: "Repository",
      status: "ACTIVE",
      externalId: "org/repo",
      configurationReference: "github-installation:123",
      capabilities: ["webhooks", "checks"],
    });
    const event = new ProjectEvent({
      id: "event-1",
      projectId: "project-1",
      type: "TASK_STATUS_CHANGED",
      payload: { taskId: "task-1", status: "VERIFIED" } as const,
      occurredAt: BASE_TIME,
    });

    expect(decision.status).toBe("ACCEPTED");
    expect(risk.evidence).toEqual(["unit-tests failed"]);
    expect(checkpoint.status).toBe("PASSED");
    expect(integration.configurationReference).toBe("github-installation:123");
    expect(event.payload.status).toBe("VERIFIED");
    expect(
      () =>
        new ProjectCheckpoint({
          id: "invalid",
          projectId: "project-1",
          name: "Invalid",
          kind: "MILESTONE",
          dueAt: BASE_TIME,
          status: "FAILED",
        }),
    ).toThrow(DomainValidationError);
  });

  it("keeps memory structured, queryable, and explicitly superseded", () => {
    const oldFact = new ProjectMemoryEntry({
      id: "fact-1",
      projectId: "project-1",
      concept: "ARCHITECTURE",
      subject: "database",
      content: "Use SQLite",
      source: "HUMAN_CONFIRMED",
      tags: ["storage"],
      recordedAt: BASE_TIME,
    });
    const newFact = new ProjectMemoryEntry({
      id: "fact-2",
      projectId: "project-1",
      concept: "ARCHITECTURE",
      subject: "database",
      content: "Use PostgreSQL",
      source: "HUMAN_CONFIRMED",
      tags: ["storage"],
      supersedesId: oldFact.id,
      recordedAt: new Date(BASE_TIME.getTime() + 1),
    });
    const decision = new ProjectMemoryEntry({
      id: "memory-decision",
      projectId: "project-1",
      concept: "DECISION",
      subject: "deployment",
      content: "Deploy as a modular monolith",
      source: "DOMAIN_EVENT",
      decisionId: "decision-1",
      recordedAt: new Date(BASE_TIME.getTime() + 2),
    });
    const memory = new ProjectMemory("project-1", [newFact, decision, oldFact]);

    expect(memory.query({ concepts: ["ARCHITECTURE"] }).map((entry) => entry.id)).toEqual([
      "fact-2",
    ]);
    expect(
      memory
        .query({ concepts: ["ARCHITECTURE"], includeSuperseded: true })
        .map((entry) => entry.id),
    ).toEqual(["fact-2", "fact-1"]);
    expect(memory.query({ tags: ["storage"], search: "postgres" })).toEqual([newFact]);
    expect(memory.decisions()).toEqual([decision]);
    expect(
      () =>
        new ProjectMemoryEntry({
          id: "invalid-decision",
          projectId: "project-1",
          concept: "DECISION",
          subject: "x",
          content: "y",
          source: "AI_INFERENCE",
        }),
    ).toThrow(DomainValidationError);
  });

  it("prevents evidence and task data from crossing aggregate boundaries", () => {
    const task = makeTask("task");
    expect(task.weightedEffort).toBe(1);
    expect(Object.isFrozen(task)).toBe(true);
  });
});
