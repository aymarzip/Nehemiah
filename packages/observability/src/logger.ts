import pino, { type Logger, type LoggerOptions } from "pino";
import { APPLICATION_VERSION } from "@nehemiah/shared";

const secretPaths = [
  "apiKey",
  "token",
  "secret",
  "privateKey",
  "password",
  "authorization",
  "headers.authorization",
  "headers.x-api-key",
  "headers.x-goog-api-key",
  "req.headers.authorization",
  "req.headers.x-nehemiah-internal-token",
  "req.headers.x-hub-signature-256",
  "config.*.apiKey",
  "config.*.token",
  "config.*.secret",
  "config.*.privateKey",
];

export interface LoggerConfiguration {
  readonly level: NonNullable<LoggerOptions["level"]>;
  readonly service: string;
  readonly environment: string;
}

export function createLogger(configuration: LoggerConfiguration): Logger {
  return pino({
    level: configuration.level,
    base: {
      service: configuration.service,
      environment: configuration.environment,
      version: APPLICATION_VERSION,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: secretPaths, censor: "[REDACTED]" },
    serializers: {
      err: pino.stdSerializers.err,
      req(request: { method?: string; url?: string; id?: string }) {
        return { method: request.method, url: request.url, id: request.id };
      },
    },
  });
}

export type { Logger };
