import { describe, expect, it } from "vitest";
import {
  CycleDetectedError,
  DomainValidationError,
  TaskDependency,
  TaskGraph,
} from "../src/index.js";
import { makeTask } from "./factories.js";

function dependency(
  from: string,
  to: string,
  requiredStatus: "IMPLEMENTED" | "VERIFIED" = "VERIFIED",
) {
  return new TaskDependency({
    projectId: "project-1",
    dependencyTaskId: from,
    dependantTaskId: to,
    requiredStatus,
  });
}

describe("TaskGraph", () => {
  it("handles empty, singleton, long-chain, wide, and disconnected fixtures", () => {
    expect(new TaskGraph().criticalPath()).toEqual({
      taskIds: [],
      estimatedEffortHours: 0,
      weightedEffort: 0,
      duration: 0,
      weighted: false,
    });
    expect(
      new TaskGraph([makeTask("only", { estimatedEffortHours: 2 })]).criticalPath().taskIds,
    ).toEqual(["only"]);

    const chainTasks = Array.from({ length: 300 }, (_, index) =>
      makeTask(`chain-${String(index).padStart(3, "0")}`),
    );
    const chainEdges = chainTasks
      .slice(1)
      .map((task, index) => dependency(chainTasks[index]!.id, task.id));
    const chain = new TaskGraph(chainTasks, chainEdges);
    expect(chain.topologicalOrder()).toHaveLength(300);
    expect(chain.criticalPath()).toMatchObject({
      taskIds: chainTasks.map((task) => task.id),
      duration: 300,
    });

    const wide = new TaskGraph(
      [makeTask("root"), makeTask("a", { estimatedEffortHours: 2 }), makeTask("b"), makeTask("z")],
      [dependency("root", "a"), dependency("root", "b")],
    );
    expect(wide.criticalPath().taskIds).toEqual(["root", "a"]);
    expect(wide.topologicalOrder().map((task) => task.id)).toEqual(["root", "a", "b", "z"]);
  });

  it("indexes dependencies and dependants in deterministic order", () => {
    const graph = new TaskGraph(
      [makeTask("c"), makeTask("a"), makeTask("b")],
      [dependency("b", "c"), dependency("a", "c")],
    );

    expect(graph.tasks().map((task) => task.id)).toEqual(["a", "b", "c"]);
    expect(graph.getDependencies("c").map((edge) => edge.dependencyTaskId)).toEqual(["a", "b"]);
    expect(graph.getDependants("a").map((edge) => edge.dependantTaskId)).toEqual(["c"]);
    expect(graph.getDependencyTasks("c").map((task) => task.id)).toEqual(["a", "b"]);
  });

  it("detects ready tasks using each edge's required completion level", () => {
    const implemented = makeTask("implemented", { status: "IMPLEMENTED" });
    const verified = makeTask("verified", { status: "VERIFIED" });
    const readyAtImplementation = makeTask("ready-implementation");
    const waitingForVerification = makeTask("wait-verification");
    const readyAtVerification = makeTask("ready-verification");
    const independent = makeTask("independent", { status: "READY" });
    const graph = new TaskGraph(
      [
        implemented,
        verified,
        readyAtImplementation,
        waitingForVerification,
        readyAtVerification,
        independent,
      ],
      [
        dependency("implemented", "ready-implementation", "IMPLEMENTED"),
        dependency("implemented", "wait-verification"),
        dependency("verified", "ready-verification"),
      ],
    );

    expect(graph.getReadyTasks().map((task) => task.id)).toEqual([
      "independent",
      "ready-implementation",
      "ready-verification",
    ]);
    expect(graph.unmetDependencies("wait-verification")).toHaveLength(1);
  });

  it("explains explicit, blocked-dependency, and cancelled-dependency blockage", () => {
    const explicit = makeTask("explicit", { status: "BLOCKED", blockReason: "Waiting for art" });
    const cancelled = makeTask("cancelled", { status: "CANCELLED" });
    const downstream = makeTask("downstream");
    const transitive = makeTask("transitive");
    const graph = new TaskGraph(
      [explicit, cancelled, downstream, transitive],
      [
        dependency("explicit", "downstream"),
        dependency("cancelled", "downstream"),
        dependency("downstream", "transitive"),
      ],
    );

    const details = graph.getBlockedTaskDetails();
    expect(details.map(({ task }) => task.id)).toEqual(["downstream", "explicit", "transitive"]);
    const downstreamDetails = details.find(({ task }) => task.id === "downstream");
    expect(downstreamDetails?.reasons.map((reason) => reason.code)).toEqual([
      "CANCELLED_DEPENDENCY",
      "BLOCKED_DEPENDENCY",
    ]);
    expect(details.find(({ task }) => task.id === "explicit")?.reasons[0]?.evidence).toBe(
      "Waiting for art",
    );
    expect(details.find(({ task }) => task.id === "transitive")?.reasons[0]?.code).toBe(
      "BLOCKED_DEPENDENCY",
    );
  });

  it("finds a cycle in imported data and rejects topological ordering", () => {
    const graph = new TaskGraph(
      [makeTask("a"), makeTask("b"), makeTask("c")],
      [dependency("a", "b"), dependency("b", "c"), dependency("c", "a")],
    );

    expect(graph.hasCycle()).toBe(true);
    expect(graph.findCycles()).toEqual([["a", "b", "c", "a"]]);
    expect(() => graph.topologicalOrder()).toThrow(CycleDetectedError);
  });

  it("rolls back an edge that would introduce a cycle", () => {
    const graph = new TaskGraph(
      [makeTask("a"), makeTask("b"), makeTask("c")],
      [dependency("a", "b"), dependency("b", "c")],
    );

    expect(() => graph.addDependency(dependency("c", "a"))).toThrow(CycleDetectedError);
    expect(graph.hasCycle()).toBe(false);
    expect(graph.dependencies()).toHaveLength(2);
  });

  it("recalculates after dependency deletion and task estimate or weight changes", () => {
    const first = makeTask("first", { estimatedEffortHours: 2 });
    const second = makeTask("second", { estimatedEffortHours: 3 });
    const graph = new TaskGraph([first, second], [dependency("first", "second")]);
    expect(graph.criticalPath().duration).toBe(5);
    expect(graph.removeDependency("first", "second")).toBe(true);
    expect(graph.removeDependency("first", "second")).toBe(false);
    expect(graph.criticalPath().taskIds).toEqual(["second"]);
    graph.replaceTask(makeTask("first", { estimatedEffortHours: 8, weight: 3 }));
    expect(graph.criticalPath().taskIds).toEqual(["first"]);
    expect(graph.criticalPath({ weighted: true })).toMatchObject({
      taskIds: ["first"],
      duration: 24,
    });
  });

  it("produces a stable topological order for independent branches", () => {
    const graph = new TaskGraph(
      [makeTask("d"), makeTask("c"), makeTask("b"), makeTask("a")],
      [dependency("a", "d"), dependency("b", "d")],
    );

    expect(graph.topologicalOrder().map((task) => task.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("calculates raw and weighted effort without counting cancelled work", () => {
    const graph = new TaskGraph([
      makeTask("low", { estimatedEffortHours: 4, impact: "LOW" }),
      makeTask("critical", { estimatedEffortHours: 2, impact: "CRITICAL", weight: 2 }),
      makeTask("done", { estimatedEffortHours: 3, status: "VERIFIED" }),
      makeTask("cancelled", { estimatedEffortHours: 100, status: "CANCELLED" }),
    ]);

    expect(graph.estimatedEffort()).toBe(9);
    expect(graph.estimatedEffort({ remainingOnly: true })).toBe(6);
    expect(graph.weightedEstimatedEffort()).toBe(16);
    expect(graph.weightedEstimatedEffort({ remainingOnly: true })).toBe(13);
  });

  it("calculates the longest critical path using task durations", () => {
    const graph = new TaskGraph(
      [
        makeTask("foundation", { estimatedEffortHours: 2 }),
        makeTask("short", { estimatedEffortHours: 3 }),
        makeTask("long", { estimatedEffortHours: 8 }),
        makeTask("release", { estimatedEffortHours: 1 }),
      ],
      [
        dependency("foundation", "short"),
        dependency("foundation", "long"),
        dependency("short", "release"),
        dependency("long", "release"),
      ],
    );

    expect(graph.criticalPath()).toEqual({
      taskIds: ["foundation", "long", "release"],
      estimatedEffortHours: 11,
      weightedEffort: 11,
      duration: 11,
      weighted: false,
    });
  });

  it("can choose a different critical path from weighted impact", () => {
    const graph = new TaskGraph(
      [
        makeTask("start", { estimatedEffortHours: 1 }),
        makeTask("raw-long", { estimatedEffortHours: 6, impact: "LOW" }),
        makeTask("weighted-long", { estimatedEffortHours: 3, impact: "CRITICAL", weight: 2 }),
        makeTask("end", { estimatedEffortHours: 1 }),
      ],
      [
        dependency("start", "raw-long"),
        dependency("start", "weighted-long"),
        dependency("raw-long", "end"),
        dependency("weighted-long", "end"),
      ],
    );

    expect(graph.criticalPath().taskIds).toEqual(["start", "raw-long", "end"]);
    expect(graph.criticalPath({ weighted: true }).taskIds).toEqual([
      "start",
      "weighted-long",
      "end",
    ]);
  });

  it("validates task references, projects, and duplicate edges", () => {
    expect(() => new TaskGraph([makeTask("a")], [dependency("missing", "a")])).toThrow();
    expect(() => new TaskGraph([makeTask("a"), makeTask("b", { projectId: "other" })])).toThrow(
      DomainValidationError,
    );
    expect(
      () =>
        new TaskGraph([makeTask("a"), makeTask("b")], [dependency("a", "b"), dependency("a", "b")]),
    ).toThrow();
  });
});
