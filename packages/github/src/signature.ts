import { createHmac, timingSafeEqual } from "node:crypto";

const signaturePattern = /^sha256=([a-f0-9]{64})$/iu;

export function signGitHubWebhook(payload: string | Buffer, secret: string): string {
  if (secret.length === 0) {
    throw new TypeError("GitHub webhook secret must not be empty");
  }
  return `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
}

export function verifyGitHubWebhookSignature(
  payload: string | Buffer,
  signature: string | undefined,
  secret: string,
): boolean {
  if (secret.length === 0 || signature === undefined) {
    return false;
  }
  const match = signaturePattern.exec(signature.trim());
  if (match?.[1] === undefined) {
    return false;
  }
  const expected = Buffer.from(signGitHubWebhook(payload, secret).slice("sha256=".length), "hex");
  const actual = Buffer.from(match[1], "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
