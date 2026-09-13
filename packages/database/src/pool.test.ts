import { describe, expect, it } from "vitest";
import { createPostgresPool } from "./pool.js";

describe("createPostgresPool", () => {
  it("creates a pg pool with configured options and defaults", () => {
    const pool = createPostgresPool({
      connectionString: "postgresql://user:pass@localhost:5432/testdb",
      max: 15,
      applicationName: "test-app",
      statementTimeoutMs: 12000,
      idleTimeoutMs: 15000,
      connectionTimeoutMs: 8000,
    });
    expect(pool).toBeDefined();
    expect(pool.options.max).toBe(15);
    expect(pool.options.application_name).toBe("test-app");
    expect(pool.options.query_timeout).toBe(12000);
    expect(pool.options.statement_timeout).toBe(12000);
    expect(pool.options.idleTimeoutMillis).toBe(15000);
    expect(pool.options.connectionTimeoutMillis).toBe(8000);
  });

  it("uses sensible defaults when optional parameters are omitted", () => {
    const pool = createPostgresPool({
      connectionString: "postgresql://user:pass@localhost:5432/testdb",
    });
    expect(pool.options.max).toBe(10);
    expect(pool.options.application_name).toBe("nehemiah");
    expect(pool.options.query_timeout).toBe(30000);
    expect(pool.options.statement_timeout).toBe(30000);
  });
});
