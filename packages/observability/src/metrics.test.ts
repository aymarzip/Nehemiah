import { describe, expect, it } from "vitest";
import { OperationalMetrics } from "./metrics.js";

describe("OperationalMetrics", () => {
  it("counts safe categories without retaining request or prompt bodies", () => {
    const metrics = new OperationalMetrics();
    metrics.recordHttp(200);
    metrics.recordHttp(503);
    metrics.recordWebhook("accepted");
    metrics.recordWebhook("duplicate");
    metrics.recordLlm("fake");
    metrics.recordLlm("anthropic", true);
    expect(metrics.snapshot()).toMatchObject({
      httpRequests: 2,
      httpErrors: 1,
      httpByStatus: { "200": 1, "503": 1 },
      webhookAccepted: 1,
      webhookDuplicates: 1,
      llmRequests: 2,
      llmFailures: 1,
      llmByProvider: { fake: 1, anthropic: 1 },
    });
  });
});
