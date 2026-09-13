import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Pool, PoolClient } from "pg";

export interface MigrationOptions {
  readonly directory?: string;
  readonly advisoryLock?: boolean;
}

export interface MigrationReport {
  readonly applied: readonly string[];
  readonly alreadyApplied: readonly string[];
}

const defaultDirectory = fileURLToPath(new URL("../migrations", import.meta.url));

async function applyMigration(client: PoolClient, name: string, sql: string): Promise<void> {
  await client.query("BEGIN");
  try {
    await client.query(sql);
    await client.query("INSERT INTO nehemiah_migrations (name) VALUES ($1)", [name]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function runMigrations(
  pool: Pool,
  options: MigrationOptions = {},
): Promise<MigrationReport> {
  const directory = options.directory ?? defaultDirectory;
  const client = await pool.connect();
  const advisoryLock = options.advisoryLock ?? true;
  try {
    if (advisoryLock) {
      await client.query("SELECT pg_advisory_lock(hashtext($1))", ["nehemiah:migrations"]);
    }
    await client.query(`
      CREATE TABLE IF NOT EXISTS nehemiah_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const result = await client.query<{ name: string }>(
      "SELECT name FROM nehemiah_migrations ORDER BY name",
    );
    const alreadyApplied = result.rows.map((row) => row.name);
    const appliedNames = new Set(alreadyApplied);
    const files = (await readdir(directory))
      .filter((file) => /^\d+_[a-z0-9_-]+\.sql$/u.test(file))
      .sort((left, right) => left.localeCompare(right));
    const applied: string[] = [];
    for (const file of files) {
      if (appliedNames.has(file)) continue;
      await applyMigration(client, file, await readFile(`${directory}/${file}`, "utf8"));
      applied.push(file);
    }
    return { applied, alreadyApplied };
  } finally {
    if (advisoryLock) {
      await client.query("SELECT pg_advisory_unlock(hashtext($1))", ["nehemiah:migrations"]);
    }
    client.release();
  }
}
