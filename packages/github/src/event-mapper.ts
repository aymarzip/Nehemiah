import type { GitHubSignal, GitHubWebhookEnvelope } from "./types.js";

type JsonObject = Readonly<Record<string, unknown>>;

function object(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function nested(source: JsonObject, key: string): JsonObject {
  return object(source[key]) ?? {};
}

function string(source: JsonObject, key: string, fallback = "unknown"): string {
  return typeof source[key] === "string" ? source[key] : fallback;
}

function number(source: JsonObject, key: string): number {
  return typeof source[key] === "number" ? source[key] : 0;
}

function boolean(source: JsonObject, key: string): boolean {
  return source[key] === true;
}

function repositoryIds(value: unknown): readonly number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => number(object(entry) ?? {}, "id"))
    .filter((id) => Number.isSafeInteger(id) && id > 0);
}

function optionalString(source: JsonObject, key: string): string | undefined {
  const value = source[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalField<Key extends string>(
  key: Key,
  value: string | undefined,
): Partial<Record<Key, string>> {
  return value === undefined ? {} : ({ [key]: value } as Record<Key, string>);
}

function changedFiles(commits: unknown): readonly string[] {
  if (!Array.isArray(commits)) return [];
  return [
    ...new Set(
      commits.flatMap((entry) => {
        const commit = object(entry) ?? {};
        return [commit["added"], commit["modified"], commit["removed"]].flatMap((value) =>
          Array.isArray(value)
            ? value.filter((file): file is string => typeof file === "string")
            : [],
        );
      }),
    ),
  ];
}

function pullRequestNumbers(value: unknown): readonly number[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const id = number(object(entry) ?? {}, "number");
    return id > 0 ? [id] : [];
  });
}

export function mapGitHubEvent(envelope: GitHubWebhookEnvelope): readonly GitHubSignal[] {
  const payload = envelope.payload;
  const action = envelope.action ?? "unknown";
  switch (envelope.eventName) {
    case "push": {
      const commits = payload["commits"];
      const headCommit = nested(payload, "head_commit");
      return [
        {
          type: "push",
          ref: string(payload, "ref"),
          after: string(payload, "after"),
          commitCount: Array.isArray(commits) ? commits.length : 0,
          changedFiles: changedFiles(commits),
          ...optionalField("occurredAt", optionalString(headCommit, "timestamp")),
        },
      ];
    }
    case "pull_request": {
      const pullRequest = nested(payload, "pull_request");
      return [
        {
          type: "pull_request",
          action,
          number: number(payload, "number"),
          merged: boolean(pullRequest, "merged"),
          draft: boolean(pullRequest, "draft"),
          title: string(pullRequest, "title"),
          changedFileCount: number(pullRequest, "changed_files"),
          ...optionalField("url", optionalString(pullRequest, "html_url")),
          ...optionalField("branch", optionalString(nested(pullRequest, "head"), "ref")),
          ...optionalField("openedAt", optionalString(pullRequest, "created_at")),
          ...optionalField("updatedAt", optionalString(pullRequest, "updated_at")),
        },
      ];
    }
    case "pull_request_review": {
      const review = nested(payload, "review");
      const pullRequest = nested(payload, "pull_request");
      return [
        {
          type: "pull_request_review",
          action,
          pullRequestNumber: number(pullRequest, "number"),
          reviewId: number(review, "id"),
          state: string(review, "state"),
          ...optionalField("url", optionalString(review, "html_url")),
          ...optionalField("occurredAt", optionalString(review, "submitted_at")),
        },
      ];
    }
    case "issues": {
      const issue = nested(payload, "issue");
      return [
        {
          type: "issue",
          action,
          number: number(issue, "number"),
          title: string(issue, "title"),
          ...optionalField("url", optionalString(issue, "html_url")),
          ...optionalField("occurredAt", optionalString(issue, "updated_at")),
        },
      ];
    }
    case "check_run":
    case "check_suite": {
      const check = nested(payload, envelope.eventName);
      const conclusion = string(check, "conclusion", "");
      return [
        {
          type: "check",
          source: envelope.eventName,
          action,
          checkId: number(check, "id"),
          status: string(check, "status"),
          ...(conclusion.length === 0 ? {} : { conclusion }),
          ...optionalField("url", optionalString(check, "html_url")),
          pullRequestNumbers: pullRequestNumbers(check["pull_requests"]),
          ...optionalField(
            "occurredAt",
            optionalString(check, "completed_at") ?? optionalString(check, "started_at"),
          ),
        },
      ];
    }
    case "workflow_run": {
      const run = nested(payload, "workflow_run");
      const conclusion = string(run, "conclusion", "");
      return [
        {
          type: "workflow_run",
          action,
          workflowRunId: number(run, "id"),
          status: string(run, "status"),
          ...(conclusion.length === 0 ? {} : { conclusion }),
          ...optionalField("url", optionalString(run, "html_url")),
          ...optionalField("branch", optionalString(run, "head_branch")),
          ...optionalField("occurredAt", optionalString(run, "updated_at")),
        },
      ];
    }
    case "installation": {
      const installation = nested(payload, "installation");
      const account = nested(installation, "account");
      const accountLogin = string(account, "login", "");
      return [
        {
          type: "installation",
          action,
          installationId: number(installation, "id"),
          ...(accountLogin.length === 0 ? {} : { accountLogin }),
        },
      ];
    }
    case "installation_repositories":
      return [
        {
          type: "installation_repositories",
          action,
          installationId: number(nested(payload, "installation"), "id"),
          addedRepositoryIds: repositoryIds(payload["repositories_added"]),
          removedRepositoryIds: repositoryIds(payload["repositories_removed"]),
        },
      ];
  }
}
