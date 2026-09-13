import { describe, expect, it, vi } from "vitest";
import {
  HttpDirectorApiClient,
  InMemorySetupDraftStore,
  buildDiscordCommands,
  canSetUpProject,
} from "./index.js";

describe("Discord commands", () => {
  it("registers the complete v1.0 command surface", () => {
    const commands = buildDiscordCommands();
    expect(commands.map((command) => command.name)).toEqual([
      "project",
      "team",
      "task",
      "producer",
      "blocker",
    ]);
    expect(
      commands.find((command) => command.name === "project")?.options?.map((option) => option.name),
    ).toEqual(["setup", "status", "mission-control", "decisions", "demo"]);
  });

  it("treats Discord defaults as UX and checks Manage Server at runtime", () => {
    expect(canSetUpProject(true, true)).toBe(true);
    expect(canSetUpProject(true, false)).toBe(false);
    expect(canSetUpProject(false, true)).toBe(false);
  });
});

describe("setup drafts", () => {
  it("are user/guild-bound, expiring, and one-time", async () => {
    const store = new InMemorySetupDraftStore(1_000);
    const now = new Date("2026-08-13T00:00:00Z");
    const draft = await store.create(
      { guildId: "g", userId: "u", mode: "GAME_JAM", constraints: [] },
      now,
    );
    await expect(store.take(draft.id, "attacker", "g", now)).resolves.toBeUndefined();
    const second = await store.create(
      { guildId: "g", userId: "u", mode: "STANDARD", constraints: [] },
      now,
    );
    await expect(
      store.take(second.id, "u", "g", new Date(now.getTime() + 1_001)),
    ).resolves.toBeUndefined();
    const third = await store.create(
      { guildId: "g", userId: "u", mode: "STANDARD", constraints: [] },
      now,
    );
    await expect(store.take(third.id, "u", "g", now)).resolves.toMatchObject({ id: third.id });
    await expect(store.take(third.id, "u", "g", now)).resolves.toBeUndefined();
  });
});

describe("HTTP director client", () => {
  it("sends internal auth without exposing it in the payload", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ projectId: "p" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = new HttpDirectorApiClient({
      baseUrl: "http://localhost:3000/",
      internalToken: "secret",
      fetch: fetchMock,
    });
    await expect(
      client.setupProject({
        discordGuildId: "g",
        ownerExternalUserId: "u",
        ownerDisplayName: "User",
        name: "Project",
        description: "Description",
        vision: "Vision",
        deadline: "2026-08-15T00:00:00Z",
        timezone: "UTC",
        mode: "STANDARD",
        constraints: [],
      }),
    ).resolves.toEqual({ projectId: "p" });
    const request = fetchMock.mock.calls[0]?.[1];
    expect(new Headers(request?.headers).get("x-nehemiah-internal-token")).toBe("secret");
    expect(request?.body).not.toContain("secret");
  });

  it("normalizes useful API errors", async () => {
    const client = new HttpDirectorApiClient({
      baseUrl: "http://localhost",
      fetch: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ code: "FORBIDDEN", message: "Not your task" }), {
          status: 403,
        }),
      ),
    });
    await expect(client.currentTasks("g", "u")).rejects.toMatchObject({
      status: 403,
      code: "FORBIDDEN",
    });
  });
});
