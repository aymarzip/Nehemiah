import { createPostgresPool, runMigrations } from "../index.js";

const databaseUrl = process.env["DATABASE_URL"];
if (databaseUrl === undefined || databaseUrl.trim().length === 0) {
  throw new Error("DATABASE_URL is required to run migrations");
}

const pool = createPostgresPool({
  connectionString: databaseUrl,
  applicationName: "nehemiah-migrate",
  queryTimeoutMs: 5 * 60_000,
});
try {
  const report = await runMigrations(pool);
  process.stdout.write(
    report.applied.length === 0
      ? "Database is already up to date.\n"
      : `Applied migrations: ${report.applied.join(", ")}\n`,
  );
} finally {
  await pool.end();
}
