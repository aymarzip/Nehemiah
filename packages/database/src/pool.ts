import { Pool, type PoolConfig } from "pg";

export interface PoolConfiguration {
  readonly connectionString: string;
  readonly max?: number;
  readonly applicationName?: string;
  readonly queryTimeoutMs?: number;
  readonly statementTimeoutMs?: number;
  readonly idleTimeoutMs?: number;
  readonly connectionTimeoutMs?: number;
}

export function createPostgresPool(configuration: PoolConfiguration): Pool {
  const statementTimeout =
    configuration.statementTimeoutMs ?? configuration.queryTimeoutMs ?? 30_000;
  const options: PoolConfig = {
    connectionString: configuration.connectionString,
    max: configuration.max ?? 10,
    application_name: configuration.applicationName ?? "nehemiah",
    idleTimeoutMillis: configuration.idleTimeoutMs ?? 30_000,
    connectionTimeoutMillis: configuration.connectionTimeoutMs ?? 10_000,
    query_timeout: statementTimeout,
    statement_timeout: statementTimeout,
    allowExitOnIdle: false,
  };
  return new Pool(options);
}

export type { Pool };
