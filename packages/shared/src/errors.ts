export type ErrorDetails = Readonly<Record<string, unknown>>;

export class NehemiahError extends Error {
  readonly code: string;
  readonly details: ErrorDetails;

  constructor(code: string, message: string, details: ErrorDetails = {}, options?: ErrorOptions) {
    super(message, options);
    this.name = "NehemiahError";
    this.code = code;
    this.details = details;
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

export function assertNever(value: never, context = "value"): never {
  throw new NehemiahError("UNEXPECTED_VARIANT", `Unexpected ${context}`, { value });
}
