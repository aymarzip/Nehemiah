import { randomUUID } from "node:crypto";

export interface SetupDraft {
  readonly id: string;
  readonly guildId: string;
  readonly userId: string;
  readonly mode: "STANDARD" | "GAME_JAM";
  readonly githubRepository?: string;
  readonly constraints: readonly string[];
  readonly expiresAt: Date;
}

export interface SetupDraftStore {
  create(input: Omit<SetupDraft, "id" | "expiresAt">, now?: Date): Promise<SetupDraft>;
  take(id: string, userId: string, guildId: string, now?: Date): Promise<SetupDraft | undefined>;
}

export class InMemorySetupDraftStore implements SetupDraftStore {
  readonly #drafts = new Map<string, SetupDraft>();
  readonly #ttlMs: number;

  constructor(ttlMs = 10 * 60_000) {
    this.#ttlMs = ttlMs;
  }

  async create(input: Omit<SetupDraft, "id" | "expiresAt">, now = new Date()): Promise<SetupDraft> {
    const draft: SetupDraft = {
      ...input,
      id: randomUUID(),
      expiresAt: new Date(now.getTime() + this.#ttlMs),
    };
    this.#drafts.set(draft.id, draft);
    return draft;
  }

  async take(
    id: string,
    userId: string,
    guildId: string,
    now = new Date(),
  ): Promise<SetupDraft | undefined> {
    const draft = this.#drafts.get(id);
    this.#drafts.delete(id);
    if (
      draft === undefined ||
      draft.userId !== userId ||
      draft.guildId !== guildId ||
      draft.expiresAt <= now
    ) {
      return undefined;
    }
    return draft;
  }
}
