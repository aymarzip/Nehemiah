import { describe, expect, it } from "vitest";
import { FixedClock, asId, createId } from "./index.js";

describe("shared primitives", () => {
  it("creates stable fixed-clock values without leaking mutable Dates", () => {
    const clock = new FixedClock("2026-08-13T12:00:00.000Z");
    const first = clock.now();
    first.setUTCFullYear(2000);
    expect(clock.now().toISOString()).toBe("2026-08-13T12:00:00.000Z");
  });

  it("rejects empty identifiers and creates UUIDs", () => {
    expect(() => asId("   ")).toThrow("must not be empty");
    expect(createId<string>()).toMatch(/^[0-9a-f-]{36}$/u);
  });
});
