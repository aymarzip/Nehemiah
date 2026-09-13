import { LlmError, errorFromResponse, normalizeError } from "./errors.js";

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface TransportOptions {
  readonly fetch?: FetchLike;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
}

export interface JsonRequestOptions {
  readonly url: string;
  readonly provider: string;
  readonly model?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body: unknown;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly fetch?: FetchLike;
}

export const DEFAULT_MAX_LLM_RESPONSE_BYTES = 8 * 1_024 * 1_024;

const effectiveSignal = (
  callerSignal: AbortSignal | undefined,
  timeoutSignal: AbortSignal,
): AbortSignal =>
  callerSignal === undefined ? timeoutSignal : AbortSignal.any([callerSignal, timeoutSignal]);

interface ResponseLifecycle {
  readonly controller: AbortController;
  readonly signal: AbortSignal;
  readonly callerSignal?: AbortSignal;
  readonly timeout: ReturnType<typeof setTimeout>;
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;
  readonly provider: string;
  readonly model?: string;
}

const responseLifecycles = new WeakMap<Response, ResponseLifecycle>();

const lifecycleAbortError = (
  lifecycle: ResponseLifecycle,
  cause?: unknown,
): LlmError | undefined => {
  if (lifecycle.callerSignal?.aborted === true) {
    return new LlmError({
      code: "aborted",
      message: `${lifecycle.provider} request was aborted`,
      provider: lifecycle.provider,
      ...(lifecycle.model === undefined ? {} : { model: lifecycle.model }),
      ...(cause === undefined ? {} : { cause }),
    });
  }
  if (lifecycle.controller.signal.aborted) {
    return new LlmError({
      code: "timeout",
      message: `${lifecycle.provider} request timed out after ${lifecycle.timeoutMs}ms`,
      provider: lifecycle.provider,
      ...(lifecycle.model === undefined ? {} : { model: lifecycle.model }),
      retryable: true,
      ...(cause === undefined ? {} : { cause }),
    });
  }
  return undefined;
};

const requiredLifecycleAbortError = (lifecycle: ResponseLifecycle): LlmError =>
  lifecycleAbortError(lifecycle) ??
  new LlmError({
    code: "aborted",
    message: `${lifecycle.provider} request was aborted`,
    provider: lifecycle.provider,
    ...(lifecycle.model === undefined ? {} : { model: lifecycle.model }),
  });

const awaitWithinLifecycle = <T>(
  operation: Promise<T>,
  lifecycle: ResponseLifecycle | undefined,
): Promise<T> => {
  if (lifecycle === undefined) return operation;
  if (lifecycle.signal.aborted) {
    void operation.catch(() => undefined);
    return Promise.reject(requiredLifecycleAbortError(lifecycle));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(requiredLifecycleAbortError(lifecycle));
    lifecycle.signal.addEventListener("abort", onAbort, { once: true });
    void operation.then(
      (value) => {
        lifecycle.signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        lifecycle.signal.removeEventListener("abort", onAbort);
        reject(
          error instanceof Error
            ? error
            : new Error("LLM transport operation failed", { cause: error }),
        );
      },
    );
  });
};

const releaseResponse = (response: Response): void => {
  const lifecycle = responseLifecycles.get(response);
  if (lifecycle === undefined) return;
  clearTimeout(lifecycle.timeout);
  responseLifecycles.delete(response);
};

const normalizeRequestError = (error: unknown, lifecycle: ResponseLifecycle): LlmError =>
  lifecycleAbortError(lifecycle, error) ??
  normalizeError(error, lifecycle.provider, lifecycle.model);

const normalizeBodyReadError = (
  error: unknown,
  response: Response,
  provider: string,
  model?: string,
): LlmError | undefined => {
  const lifecycle = responseLifecycles.get(response);
  const lifecycleError =
    lifecycle === undefined ? undefined : lifecycleAbortError(lifecycle, error);
  if (lifecycleError !== undefined) return lifecycleError;
  if (error instanceof LlmError) return error;
  if (error instanceof DOMException && error.name === "AbortError") {
    return normalizeError(error, provider, model);
  }
  if (error instanceof TypeError) return normalizeError(error, provider, model);
  return undefined;
};

export const postJson = async (options: JsonRequestOptions): Promise<Response> => {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 60_000;
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_LLM_RESPONSE_BYTES;
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes <= 0) {
    throw new TypeError("maxResponseBytes must be a positive safe integer");
  }
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref();
  const lifecycle: ResponseLifecycle = {
    controller,
    signal: effectiveSignal(options.signal, controller.signal),
    ...(options.signal === undefined ? {} : { callerSignal: options.signal }),
    timeout,
    timeoutMs,
    maxResponseBytes,
    provider: options.provider,
    ...(options.model === undefined ? {} : { model: options.model }),
  };
  try {
    const response = await awaitWithinLifecycle(
      (options.fetch ?? globalThis.fetch)(options.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...options.headers,
        },
        body: JSON.stringify(options.body),
        signal: lifecycle.signal,
      }),
      lifecycle,
    );
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > maxResponseBytes) {
      throw new LlmError({
        code: "invalid_response",
        message: `${options.provider} response exceeded the ${maxResponseBytes}-byte limit`,
        provider: options.provider,
        ...(options.model === undefined ? {} : { model: options.model }),
      });
    }
    if (!response.ok) {
      throw await awaitWithinLifecycle(
        errorFromResponse(
          response,
          options.provider,
          options.model,
          Math.min(maxResponseBytes, 1_048_576),
        ),
        lifecycle,
      );
    }
    responseLifecycles.set(response, lifecycle);
    return response;
  } catch (error) {
    clearTimeout(timeout);
    throw normalizeRequestError(error, lifecycle);
  }
};

export const readJson = async <T>(
  response: Response,
  provider: string,
  model?: string,
): Promise<T> => {
  try {
    const lifecycle = responseLifecycles.get(response);
    const body = response.body;
    if (body === null) throw new SyntaxError("Response has no body");
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let text = "";
    let received = 0;
    try {
      while (true) {
        const chunk = await awaitWithinLifecycle(reader.read(), lifecycle);
        if (chunk.done) break;
        const bytes = chunk.value as Uint8Array;
        received += bytes.byteLength;
        if (received > (lifecycle?.maxResponseBytes ?? DEFAULT_MAX_LLM_RESPONSE_BYTES)) {
          await reader.cancel();
          throw new LlmError({
            code: "invalid_response",
            message: `${provider} response exceeded the ${lifecycle?.maxResponseBytes ?? DEFAULT_MAX_LLM_RESPONSE_BYTES}-byte limit`,
            provider,
            ...(model === undefined ? {} : { model }),
          });
        }
        text += decoder.decode(bytes, { stream: true });
      }
      text += decoder.decode();
      return JSON.parse(text) as T;
    } finally {
      reader.releaseLock();
    }
  } catch (cause) {
    const normalized = normalizeBodyReadError(cause, response, provider, model);
    if (normalized !== undefined) throw normalized;
    throw new LlmError({
      code: "invalid_response",
      message: `${provider} returned an invalid JSON response`,
      provider,
      ...(model === undefined ? {} : { model }),
      cause,
    });
  } finally {
    releaseResponse(response);
  }
};

async function* textLines(response: Response, provider: string): AsyncGenerator<string> {
  const body = response.body;
  if (body === null) {
    throw new LlmError({
      code: "invalid_response",
      message: `${provider} returned a streaming response without a body`,
      provider,
    });
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let complete = false;
  let received = 0;
  try {
    while (true) {
      const chunk = await awaitWithinLifecycle(reader.read(), responseLifecycles.get(response));
      if (chunk.done) break;
      const bytes = chunk.value as Uint8Array;
      received += bytes.byteLength;
      const limit =
        responseLifecycles.get(response)?.maxResponseBytes ?? DEFAULT_MAX_LLM_RESPONSE_BYTES;
      if (received > limit) {
        throw new LlmError({
          code: "invalid_response",
          message: `${provider} response exceeded the ${limit}-byte limit`,
          provider,
        });
      }
      buffer += decoder.decode(bytes, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const raw = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        yield raw.endsWith("\r") ? raw.slice(0, -1) : raw;
        newline = buffer.indexOf("\n");
      }
    }
    buffer += decoder.decode();
    if (buffer.length > 0) yield buffer.endsWith("\r") ? buffer.slice(0, -1) : buffer;
    complete = true;
  } finally {
    if (!complete) {
      try {
        await reader.cancel();
      } catch {
        // ignore cancellation error
      }
    }
    reader.releaseLock();
  }
}

export interface SseEvent {
  readonly event?: string;
  readonly data: string;
  readonly id?: string;
}

export async function* parseSse(response: Response, provider: string): AsyncGenerator<SseEvent> {
  let event: string | undefined;
  let id: string | undefined;
  let data: string[] = [];
  const emit = (): SseEvent | undefined => {
    if (data.length === 0) return undefined;
    const result: SseEvent = {
      data: data.join("\n"),
      ...(event === undefined ? {} : { event }),
      ...(id === undefined ? {} : { id }),
    };
    event = undefined;
    data = [];
    return result;
  };
  try {
    for await (const line of textLines(response, provider)) {
      if (line === "") {
        const parsed = emit();
        if (parsed !== undefined) yield parsed;
        continue;
      }
      if (line.startsWith(":")) continue;
      const separator = line.indexOf(":");
      const field = separator < 0 ? line : line.slice(0, separator);
      const rawValue = separator < 0 ? "" : line.slice(separator + 1);
      const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;
      if (field === "event") event = value;
      else if (field === "data") data.push(value);
      else if (field === "id") id = value;
    }
    const parsed = emit();
    if (parsed !== undefined) yield parsed;
  } catch (error) {
    throw normalizeBodyReadError(error, response, provider) ?? normalizeError(error, provider);
  } finally {
    releaseResponse(response);
  }
}

export async function* parseNdjson<T = unknown>(
  response: Response,
  provider: string,
): AsyncGenerator<T> {
  try {
    for await (const line of textLines(response, provider)) {
      const trimmed = line.trim();
      if (trimmed === "" || trimmed.startsWith(":")) continue;
      try {
        yield JSON.parse(trimmed) as T;
      } catch (cause) {
        throw new LlmError({
          code: "invalid_response",
          message: `${provider} returned malformed NDJSON`,
          provider,
          partialOutput: trimmed,
          cause,
        });
      }
    }
  } catch (error) {
    throw normalizeBodyReadError(error, response, provider) ?? normalizeError(error, provider);
  } finally {
    releaseResponse(response);
  }
}

export const parseSseJson = <T>(event: SseEvent, provider: string): T => {
  try {
    return JSON.parse(event.data) as T;
  } catch (cause) {
    throw new LlmError({
      code: "invalid_response",
      message: `${provider} returned malformed SSE JSON`,
      provider,
      partialOutput: event.data,
      cause,
    });
  }
};

export const joinUrl = (baseUrl: string, path: string): string =>
  `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
