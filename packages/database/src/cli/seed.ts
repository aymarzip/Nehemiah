import { randomUUID } from "node:crypto";
import { createPostgresPool, PostgresProjectStore, runMigrations } from "../index.js";

const databaseUrl = process.env["DATABASE_URL"];
if (databaseUrl === undefined || databaseUrl.trim().length === 0) {
  throw new Error("DATABASE_URL is required to seed demo data");
}

const pool = createPostgresPool({
  connectionString: databaseUrl,
  applicationName: "nehemiah-seed",
  queryTimeoutMs: 5 * 60_000,
});
try {
  await runMigrations(pool);
  const existing = await pool.query<{ id: string }>(
    "SELECT id FROM projects WHERE name = $1 ORDER BY created_at LIMIT 1",
    ["Nehemiah Demo"],
  );
  if (existing.rows[0] === undefined) {
    const store = new PostgresProjectStore(pool);
    const now = new Date();
    const project = await store.setupProject({
      workspaceId: randomUUID(),
      projectId: randomUUID(),
      ownerMemberId: randomUUID(),
      workspaceName: "Demo workspace",
      ownerExternalUserId: "demo-owner",
      ownerDisplayName: "Demo Producer",
      name: "Nehemiah Demo",
      description: "A seeded vertical slice for local development.",
      vision: "Ship a small, verified build before the deadline.",
      deadline: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1_000),
      timezone: "UTC",
      mode: "STANDARD",
      constraints: ["Keep the critical path visible"],
      createdAt: now,
    });
    await store.createTask({
      id: randomUUID(),
      projectId: project.id,
      title: "Produce the first integrated build",
      description: "Connect implementation, verification, and release evidence.",
      impact: "CRITICAL",
      weight: 3,
      estimatedEffortHours: 6,
      now,
    });
    process.stdout.write(`Seeded demo project ${project.id}.\n`);
  } else {
    process.stdout.write(`Demo project already exists (${existing.rows[0].id}).\n`);
  }
} finally {
  await pool.end();
}
