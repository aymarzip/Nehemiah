import { supportedGitHubEvents, type GitHubWebhookEnvelope, type WebhookInbox } from "./types.js";
import { verifyGitHubWebhookSignature } from "./signature.js";

export type WebhookHeaders = Readonly<Record<string, string | readonly string[] | undefined>>;

export type WebhookReceipt =
  | { readonly outcome: "accepted"; readonly deliveryId: string }
  | { readonly outcome: "duplicate"; readonly deliveryId: string }
  | { readonly outcome: "ignored"; readonly eventName: string };

export class GitHubWebhookError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "GitHubWebhookError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function header(headers: WebhookHeaders, name: string): string | undefined {
  const direct = headers[name] ?? headers[name.toLowerCase()];
  return typeof direct === "string" ? direct : direct?.[0];
}

function objectAt(value: unknown, key: string): Readonly<Record<string, unknown>> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const nested = (value as Record<string, unknown>)[key];
  return typeof nested === "object" && nested !== null && !Array.isArray(nested)
    ? (nested as Readonly<Record<string, unknown>>)
    : undefined;
}

function numberAt(
  value: Readonly<Record<string, unknown>> | undefined,
  key: string,
): number | undefined {
  const candidate = value?.[key];
  return typeof candidate === "number" && Number.isSafeInteger(candidate) ? candidate : undefined;
}

function stringAt(
  value: Readonly<Record<string, unknown>> | undefined,
  key: string,
): string | undefined {
  const candidate = value?.[key];
  return typeof candidate === "string" ? candidate : undefined;
}

function parseObject(rawPayload: string): Readonly<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(rawPayload);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new TypeError("Webhook payload must be a JSON object");
    }
    return parsed as Readonly<Record<string, unknown>>;
  } catch (error) {
    throw new GitHubWebhookError(400, "INVALID_JSON", "GitHub webhook payload is invalid", {
      cause: error,
    });
  }
}

export class GitHubWebhookReceiver {
  readonly #secret: string;
  readonly #inbox: WebhookInbox;

  constructor(secret: string, inbox: WebhookInbox) {
    if (secret.length === 0) {
      throw new TypeError("GitHub webhook secret must not be empty");
    }
    this.#secret = secret;
    this.#inbox = inbox;
  }

  async receive(
    rawPayload: string,
    headers: WebhookHeaders,
    receivedAt = new Date(),
  ): Promise<WebhookReceipt> {
    if (
      !verifyGitHubWebhookSignature(
        rawPayload,
        header(headers, "x-hub-signature-256"),
        this.#secret,
      )
    ) {
      throw new GitHubWebhookError(401, "INVALID_SIGNATURE", "GitHub webhook signature is invalid");
    }

    const eventName = header(headers, "x-github-event")?.trim();
    if (eventName === undefined || eventName.length === 0) {
      throw new GitHubWebhookError(400, "MISSING_EVENT", "X-GitHub-Event is required");
    }
    if (eventName === "ping") {
      return { outcome: "ignored", eventName };
    }
    if (!supportedGitHubEvents.some((candidate) => candidate === eventName)) {
      return { outcome: "ignored", eventName };
    }

    const deliveryId = header(headers, "x-github-delivery")?.trim();
    if (deliveryId === undefined || deliveryId.length === 0) {
      throw new GitHubWebhookError(400, "MISSING_DELIVERY", "X-GitHub-Delivery is required");
    }

    const payload = parseObject(rawPayload);
    const repository = objectAt(payload, "repository");
    const installation = objectAt(payload, "installation");
    const sender = objectAt(payload, "sender");
    const action = stringAt(payload, "action");
    const envelope: GitHubWebhookEnvelope = {
      deliveryId,
      eventName,
      receivedAt,
      trust: "untrusted_external",
      payload,
      ...(action === undefined ? {} : { action }),
      ...(numberAt(installation, "id") === undefined
        ? {}
        : { installationId: numberAt(installation, "id") }),
      ...(numberAt(repository, "id") === undefined
        ? {}
        : { repositoryId: numberAt(repository, "id") }),
      ...(stringAt(repository, "full_name") === undefined
        ? {}
        : { repositoryFullName: stringAt(repository, "full_name") }),
      ...(numberAt(sender, "id") === undefined ? {} : { senderId: numberAt(sender, "id") }),
    } as GitHubWebhookEnvelope;
    const result = await this.#inbox.insert(envelope);
    return { outcome: result === "inserted" ? "accepted" : "duplicate", deliveryId };
  }
}
