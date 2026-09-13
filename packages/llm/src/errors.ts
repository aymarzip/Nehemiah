export type LlmErrorCode =
  | "provider_not_configured"
  | "authentication"
  | "permission"
  | "payment_required"
  | "rate_limit"
  | "timeout"
  | "context_limit"
  | "invalid_request"
  | "unsupported_capability"
  | "model_not_found"
  | "content_filter"
  | "provider_overloaded"
  | "provider_unavailable"
  | "network"
  | "aborted"
  | "invalid_response"
  | "unknown";

export interface LlmErrorOptions {
  readonly code: LlmErrorCode;
  readonly message: string;
  readonly provider?: string;
  readonly model?: string;
  readonly httpStatus?: number;
  readonly retryable?: boolean;
  readonly retryAfterMs?: number;
  readonly requestId?: string;
  readonly providerCode?: string;
  readonly partialOutput?: string;
  readonly cause?: unknown;
}

/** A secret-safe, provider-neutral error returned by every adapter. */
export class LlmError extends Error {
  readonly code: LlmErrorCode;
  readonly provider: string | undefined;
  readonly model: string | undefined;
  readonly httpStatus: number | undefined;
  readonly retryable: boolean;
  readonly retryAfterMs: number | undefined;
  readonly requestId: string | undefined;
  readonly providerCode: string | undefined;
  readonly partialOutput: string | undefined;

  constructor(options: LlmErrorOptions) {
    super(options.message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "LlmError";
    this.code = options.code;
    this.provider = options.provider;
    this.model = options.model;
    this.httpStatus = options.httpStatus;
    this.retryable = options.retryable ?? false;
    this.retryAfterMs = options.retryAfterMs;
    this.requestId = options.requestId;
    this.providerCode = options.providerCode;
    this.partialOutput = options.partialOutput;
  }
}

export const isLlmError = (error: unknown): error is LlmError => error instanceof LlmError;

export const llmError = (options: LlmErrorOptions): LlmError => new LlmError(options);

/** Best-effort redaction for provider messages that may be written to application logs. */
export const sanitizeErrorMessage = (message: string): string =>
  message
    .replace(/\bBearer\s+[^\s,;]+/giu, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/gu, "[REDACTED]")
    .replace(/\bAIza[A-Za-z0-9_-]{16,}\b/gu, "[REDACTED]")
    .replace(
      /(api[_ -]?key|access[_ -]?token|authorization)(\s*[:=]\s*)[^\s,;]+/giu,
      "$1$2[REDACTED]",
    );

export const errorCodeForHttpStatus = (status: number, providerCode?: string): LlmErrorCode => {
  const normalizedCode = providerCode?.toLowerCase() ?? "";
  if (normalizedCode.includes("context") || normalizedCode.includes("token_limit")) {
    return "context_limit";
  }
  if (normalizedCode.includes("model") && normalizedCode.includes("not_found")) {
    return "model_not_found";
  }
  if (normalizedCode.includes("content_filter") || normalizedCode.includes("safety")) {
    return "content_filter";
  }
  switch (status) {
    case 400:
    case 404:
    case 409:
    case 422:
      return status === 404 ? "model_not_found" : "invalid_request";
    case 401:
      return "authentication";
    case 402:
      return "payment_required";
    case 403:
      return "permission";
    case 408:
      return "timeout";
    case 429:
      return "rate_limit";
    case 500:
    case 502:
    case 504:
      return "provider_unavailable";
    case 503:
      return "provider_overloaded";
    default:
      return status >= 500 ? "provider_unavailable" : "unknown";
  }
};

const parseRetryAfter = (value: string | null): number | undefined => {
  if (value === null) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return undefined;
};

interface ProviderErrorBody {
  readonly message?: string;
  readonly code?: string;
  readonly type?: string;
}

const inspectErrorBody = (body: unknown): ProviderErrorBody => {
  if (typeof body !== "object" || body === null) return {};
  const record = body as Record<string, unknown>;
  const nested =
    typeof record.error === "object" && record.error !== null
      ? (record.error as Record<string, unknown>)
      : record;
  const metadata =
    typeof nested.metadata === "object" && nested.metadata !== null
      ? (nested.metadata as Record<string, unknown>)
      : undefined;
  return {
    ...(typeof nested.message === "string" ? { message: nested.message } : {}),
    ...(typeof nested.code === "string" || typeof nested.code === "number"
      ? { code: String(nested.code) }
      : typeof metadata?.error_type === "string"
        ? { code: metadata.error_type }
        : {}),
    ...(typeof nested.type === "string" ? { type: nested.type } : {}),
  };
};

export const errorFromResponse = async (
  response: Response,
  provider: string,
  model?: string,
  maxBodyBytes = 1_048_576,
): Promise<LlmError> => {
  let text = "";
  const bodyReader = response.body?.getReader();
  if (bodyReader !== undefined) {
    const decoder = new TextDecoder();
    let received = 0;
    try {
      while (true) {
        const chunk = await bodyReader.read();
        if (chunk.done) break;
        const bytes = chunk.value as Uint8Array;
        received += bytes.byteLength;
        if (received > maxBodyBytes) {
          await bodyReader.cancel();
          text = "";
          break;
        }
        text += decoder.decode(bytes, { stream: true });
      }
      text += decoder.decode();
    } finally {
      bodyReader.releaseLock();
    }
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    parsed = text === "" ? {} : { message: text };
  }
  const body = inspectErrorBody(parsed);
  const providerCode = body.code ?? body.type;
  const code = errorCodeForHttpStatus(response.status, providerCode);
  const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
  const requestId =
    response.headers.get("request-id") ??
    response.headers.get("x-request-id") ??
    response.headers.get("x-goog-request-id") ??
    undefined;
  return new LlmError({
    code,
    message: sanitizeErrorMessage(
      body.message?.trim() || `${provider} request failed with HTTP ${response.status}`,
    ),
    provider,
    ...(model === undefined ? {} : { model }),
    httpStatus: response.status,
    retryable:
      code === "rate_limit" ||
      code === "timeout" ||
      code === "provider_overloaded" ||
      code === "provider_unavailable",
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    ...(requestId === undefined ? {} : { requestId }),
    ...(providerCode === undefined ? {} : { providerCode }),
  });
};

export const normalizeError = (error: unknown, provider: string, model?: string): LlmError => {
  if (error instanceof LlmError) return error;
  if (error instanceof DOMException && error.name === "AbortError") {
    return new LlmError({
      code: "aborted",
      message: `${provider} request was aborted`,
      provider,
      ...(model === undefined ? {} : { model }),
    });
  }
  if (error instanceof TypeError) {
    return new LlmError({
      code: "network",
      message: `${provider} network request failed`,
      provider,
      ...(model === undefined ? {} : { model }),
      retryable: true,
    });
  }
  return new LlmError({
    code: "unknown",
    message: `${provider} request failed`,
    provider,
    ...(model === undefined ? {} : { model }),
  });
};
