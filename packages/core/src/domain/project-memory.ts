import { DomainValidationError, DuplicateEntityError, EntityNotFoundError } from "../errors.js";
import {
  assertDate,
  assertNonEmpty,
  clamp,
  type DecisionId,
  type MemoryEntryId,
  type ProjectId,
  type TeamMemberId,
} from "./common.js";

export const MEMORY_CONCEPTS = [
  "FACT",
  "DECISION",
  "CONSTRAINT",
  "ARCHITECTURE",
  "REQUIREMENT",
  "TEAM_INFORMATION",
  "RISK",
  "LESSON",
] as const;

export type MemoryConcept = (typeof MEMORY_CONCEPTS)[number];
export type MemorySource = "HUMAN_CONFIRMED" | "DOMAIN_EVENT" | "INTEGRATION" | "AI_INFERENCE";

export interface ProjectMemoryEntryInput {
  id: MemoryEntryId;
  projectId: ProjectId;
  concept: MemoryConcept;
  subject: string;
  content: string;
  tags?: readonly string[] | undefined;
  source: MemorySource;
  confidence?: number | undefined;
  recordedAt?: Date | undefined;
  recordedBy?: TeamMemberId | undefined;
  supersedesId?: MemoryEntryId | undefined;
  decisionId?: DecisionId | undefined;
  metadata?: Readonly<Record<string, string | number | boolean | null>> | undefined;
}

export class ProjectMemoryEntry {
  public readonly id: MemoryEntryId;
  public readonly projectId: ProjectId;
  public readonly concept: MemoryConcept;
  public readonly subject: string;
  public readonly content: string;
  public readonly tags: readonly string[];
  public readonly source: MemorySource;
  public readonly confidence: number;
  public readonly recordedAt: Date;
  public readonly recordedBy: TeamMemberId;
  public readonly supersedesId?: MemoryEntryId | undefined;
  public readonly decisionId?: DecisionId | undefined;
  public readonly metadata: Readonly<Record<string, string | number | boolean | null>>;

  public constructor(input: ProjectMemoryEntryInput) {
    this.id = assertNonEmpty(input.id, "memoryEntry.id");
    this.projectId = assertNonEmpty(input.projectId, "memoryEntry.projectId");
    this.concept = input.concept;
    this.subject = assertNonEmpty(input.subject, "memoryEntry.subject");
    this.content = assertNonEmpty(input.content, "memoryEntry.content");
    this.tags = Object.freeze(
      [...new Set(input.tags ?? [])].map((tag, index) =>
        assertNonEmpty(tag, `memoryEntry.tags[${index}]`),
      ),
    );
    this.source = input.source;
    const confidence = input.confidence ?? (input.source === "AI_INFERENCE" ? 0.5 : 1);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      throw new DomainValidationError("memoryEntry.confidence must be between 0 and 1");
    }
    this.confidence = clamp(confidence, 0, 1);
    this.recordedAt = assertDate(input.recordedAt ?? new Date(), "memoryEntry.recordedAt");
    this.recordedBy = input.recordedBy ?? "SYSTEM";
    this.supersedesId = input.supersedesId;
    this.decisionId = input.decisionId;
    if (this.concept === "DECISION" && this.decisionId === undefined) {
      throw new DomainValidationError(
        "Decision memory must reference a structured Decision entity",
      );
    }
    this.metadata = Object.freeze({ ...(input.metadata ?? {}) });
    Object.freeze(this);
  }
}

export interface ProjectMemoryQuery {
  concepts?: ReadonlySet<MemoryConcept> | readonly MemoryConcept[] | undefined;
  tags?: readonly string[] | undefined;
  source?: MemorySource | undefined;
  minimumConfidence?: number | undefined;
  includeSuperseded?: boolean | undefined;
  search?: string | undefined;
  recordedBefore?: Date | undefined;
}

export class ProjectMemory {
  readonly #entries = new Map<MemoryEntryId, ProjectMemoryEntry>();
  readonly #supersededIds = new Set<MemoryEntryId>();

  public constructor(
    public readonly projectId: ProjectId,
    entries: readonly ProjectMemoryEntry[] = [],
  ) {
    assertNonEmpty(projectId, "projectMemory.projectId");
    const pending = [...entries].sort(
      (left, right) => left.recordedAt.getTime() - right.recordedAt.getTime(),
    );
    while (pending.length > 0) {
      const insertableIndex = pending.findIndex(
        (entry) => entry.supersedesId === undefined || this.#entries.has(entry.supersedesId),
      );
      if (insertableIndex < 0) {
        throw new DomainValidationError("Project memory contains an unresolved supersession chain");
      }
      const [entry] = pending.splice(insertableIndex, 1);
      if (entry !== undefined) this.add(entry);
    }
  }

  public get size(): number {
    return this.#entries.size;
  }

  public add(entry: ProjectMemoryEntry): void {
    if (entry.projectId !== this.projectId) {
      throw new DomainValidationError("Memory entry belongs to another project", {
        projectId: this.projectId,
        entryProjectId: entry.projectId,
      });
    }
    if (this.#entries.has(entry.id)) throw new DuplicateEntityError("ProjectMemoryEntry", entry.id);
    if (entry.supersedesId !== undefined) {
      const previous = this.#entries.get(entry.supersedesId);
      if (previous === undefined)
        throw new EntityNotFoundError("ProjectMemoryEntry", entry.supersedesId);
      if (previous.concept !== entry.concept || previous.subject !== entry.subject) {
        throw new DomainValidationError(
          "A memory entry may only supersede the same concept and subject",
          { previousId: previous.id, entryId: entry.id },
        );
      }
      if (entry.recordedAt < previous.recordedAt) {
        throw new DomainValidationError("Superseding memory cannot predate the entry it replaces");
      }
      this.#supersededIds.add(previous.id);
    }
    this.#entries.set(entry.id, entry);
  }

  public get(id: MemoryEntryId): ProjectMemoryEntry | undefined {
    return this.#entries.get(id);
  }

  public require(id: MemoryEntryId): ProjectMemoryEntry {
    const entry = this.get(id);
    if (entry === undefined) throw new EntityNotFoundError("ProjectMemoryEntry", id);
    return entry;
  }

  public query(query: ProjectMemoryQuery = {}): readonly ProjectMemoryEntry[] {
    const concepts = query.concepts === undefined ? undefined : new Set(query.concepts);
    const requiredTags = new Set(query.tags ?? []);
    const needle = query.search?.trim().toLocaleLowerCase();
    const minimumConfidence = query.minimumConfidence ?? 0;
    if (minimumConfidence < 0 || minimumConfidence > 1) {
      throw new DomainValidationError("minimumConfidence must be between 0 and 1");
    }
    const before =
      query.recordedBefore === undefined
        ? undefined
        : assertDate(query.recordedBefore, "memoryQuery.recordedBefore");
    return Object.freeze(
      [...this.#entries.values()]
        .filter(
          (entry) =>
            (query.includeSuperseded === true || !this.#supersededIds.has(entry.id)) &&
            (concepts === undefined || concepts.has(entry.concept)) &&
            (query.source === undefined || entry.source === query.source) &&
            entry.confidence >= minimumConfidence &&
            [...requiredTags].every((tag) => entry.tags.includes(tag)) &&
            (before === undefined || entry.recordedAt <= before) &&
            (needle === undefined ||
              entry.subject.toLocaleLowerCase().includes(needle) ||
              entry.content.toLocaleLowerCase().includes(needle)),
        )
        .sort(
          (left, right) =>
            right.recordedAt.getTime() - left.recordedAt.getTime() ||
            left.id.localeCompare(right.id),
        ),
    );
  }

  public decisions(includeSuperseded = false): readonly ProjectMemoryEntry[] {
    return this.query({ concepts: ["DECISION"], includeSuperseded });
  }
}
