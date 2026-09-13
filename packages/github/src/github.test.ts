import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  GitHubWebhookProcessor,
  GitHubWebhookReceiver,
  InMemoryWebhookInbox,
  mapGitHubEvent,
  signGitHubWebhook,
  verifyGitHubWebhookSignature,
  type GitHubWebhookEnvelope,
} from "./index.js";

const secret = "It's a Secret to Everybody";
const payload = "Hello, World!";

describe("GitHub webhook signature", () => {
  it("matches the GitHub HMAC-SHA256 algorithm", () => {
    const expected = `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
    expect(signGitHubWebhook(payload, secret)).toBe(expected);
    expect(verifyGitHubWebhookSignature(payload, expected, secret)).toBe(true);
  });

  it("rejects malformed, missing, and incorrect signatures", () => {
    expect(verifyGitHubWebhookSignature(payload, undefined, secret)).toBe(false);
    expect(verifyGitHubWebhookSignature(payload, "sha1=abc", secret)).toBe(false);
    expect(
      verifyGitHubWebhookSignature(`${payload}!`, signGitHubWebhook(payload, secret), secret),
    ).toBe(false);
  });
});

describe("GitHubWebhookReceiver", () => {
  it("persists a valid delivery exactly once", async () => {
    const inbox = new InMemoryWebhookInbox();
    const receiver = new GitHubWebhookReceiver(secret, inbox);
    const raw = JSON.stringify({ ref: "refs/heads/main", commits: [] });
    const headers = {
      "x-hub-signature-256": signGitHubWebhook(raw, secret),
      "x-github-event": "push",
      "x-github-delivery": "delivery-1",
    };
    await expect(receiver.receive(raw, headers)).resolves.toEqual({
      outcome: "accepted",
      deliveryId: "delivery-1",
    });
    await expect(receiver.receive(raw, headers)).resolves.toEqual({
      outcome: "duplicate",
      deliveryId: "delivery-1",
    });
  });

  it("verifies before parsing and ignores unsupported signed events", async () => {
    const receiver = new GitHubWebhookReceiver(secret, new InMemoryWebhookInbox());
    await expect(
      receiver.receive("not json", {
        "x-hub-signature-256": "sha256=" + "0".repeat(64),
        "x-github-event": "push",
        "x-github-delivery": "d",
      }),
    ).rejects.toMatchObject({ statusCode: 401 });
    const raw = "{}";
    await expect(
      receiver.receive(raw, {
        "x-hub-signature-256": signGitHubWebhook(raw, secret),
        "x-github-event": "star",
        "x-github-delivery": "d",
      }),
    ).resolves.toEqual({ outcome: "ignored", eventName: "star" });
  });
});

function envelope(
  eventName: GitHubWebhookEnvelope["eventName"],
  payloadValue: Record<string, unknown>,
): GitHubWebhookEnvelope {
  return {
    deliveryId: `d-${eventName}`,
    eventName,
    action: "completed",
    receivedAt: new Date("2026-08-13T00:00:00Z"),
    trust: "untrusted_external",
    payload: payloadValue,
  };
}

describe("GitHub event mapping", () => {
  it.each([
    ["push", { ref: "refs/heads/main", after: "abc", commits: [{ id: "1" }] }, "push"],
    ["pull_request", { number: 4, pull_request: { merged: true, draft: false } }, "pull_request"],
    [
      "pull_request_review",
      { review: { state: "approved" }, pull_request: { number: 4 } },
      "pull_request_review",
    ],
    ["issues", { issue: { number: 7 } }, "issue"],
    ["check_run", { check_run: { status: "completed", conclusion: "success" } }, "check"],
    ["check_suite", { check_suite: { status: "completed", conclusion: "failure" } }, "check"],
    ["workflow_run", { workflow_run: { id: 8, status: "completed" } }, "workflow_run"],
    ["installation", { installation: { id: 9, account: { login: "team" } } }, "installation"],
    [
      "installation_repositories",
      { installation: { id: 9 }, repositories_added: [{ id: 2 }] },
      "installation_repositories",
    ],
  ] as const)("maps %s into a canonical signal", (name, body, expectedType) => {
    expect(mapGitHubEvent(envelope(name, body))[0]?.type).toBe(expectedType);
  });
});

describe("GitHubWebhookProcessor", () => {
  it("retries failed handlers without replaying successful deliveries", async () => {
    const inbox = new InMemoryWebhookInbox();
    const stored = envelope("push", { ref: "refs/heads/main", after: "abc", commits: [] });
    await inbox.insert(stored);
    const handle = vi
      .fn<(event: GitHubWebhookEnvelope) => Promise<void>>()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValue(undefined);
    const processor = new GitHubWebhookProcessor(inbox, { handle }, { baseRetryDelayMs: 10 });
    const now = new Date("2026-08-13T00:00:00Z");
    await expect(processor.processBatch(10, now)).resolves.toMatchObject({ failed: 1 });
    await expect(processor.processBatch(10, new Date(now.getTime() + 10))).resolves.toMatchObject({
      processed: 1,
    });
    await expect(processor.processBatch(10, new Date(now.getTime() + 100))).resolves.toMatchObject({
      claimed: 0,
    });
    expect(handle).toHaveBeenCalledTimes(2);
  });

  it("ignores acknowledgements from a stale reclaimed lease", async () => {
    const inbox = new InMemoryWebhookInbox();
    await inbox.insert(envelope("push", { ref: "refs/heads/main", commits: [] }));
    const now = new Date("2026-08-13T00:00:00Z");
    const first = (await inbox.claimPending(1, now))[0]!;
    await inbox.markFailed(
      first.deliveryId,
      first.claimToken,
      "retry",
      new Date(now.getTime() + 1),
      false,
    );
    const second = (await inbox.claimPending(1, new Date(now.getTime() + 1)))[0]!;
    expect(second.claimToken).not.toBe(first.claimToken);

    await inbox.markProcessed(first.deliveryId, first.claimToken, new Date(now.getTime() + 2));
    expect(inbox.status(first.deliveryId)).toBe("processing");
    await inbox.markProcessed(second.deliveryId, second.claimToken, new Date(now.getTime() + 2));
    expect(inbox.status(first.deliveryId)).toBe("processed");
  });
});
