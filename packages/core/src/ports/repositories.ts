import type {
  DecisionId,
  IntegrationId,
  MilestoneId,
  ProjectCheckpointId,
  ProjectEventId,
  ProjectId,
  RiskId,
  TaskId,
  TeamMemberId,
  WorkspaceId,
} from "../domain/common.js";
import type {
  Decision,
  Integration,
  ProjectCheckpoint,
  ProjectEvent,
  Risk,
} from "../domain/governance.js";
import type { ProjectMemory } from "../domain/project-memory.js";
import type { Milestone, Project, Workspace } from "../domain/project.js";
import type { Task, TaskDependency } from "../domain/task.js";
import type { TeamMember } from "../domain/team.js";

export interface EntityRepository<TEntity, TId> {
  findById(id: TId): Promise<TEntity | undefined>;
  save(entity: TEntity): Promise<void>;
  delete(id: TId): Promise<boolean>;
}

export type WorkspaceRepository = EntityRepository<Workspace, WorkspaceId>;

export interface ProjectRepository extends EntityRepository<Project, ProjectId> {
  findByWorkspace(workspaceId: WorkspaceId): Promise<readonly Project[]>;
}

export interface TeamMemberRepository extends EntityRepository<TeamMember, TeamMemberId> {
  findByWorkspace(workspaceId: WorkspaceId): Promise<readonly TeamMember[]>;
  findByProject(projectId: ProjectId): Promise<readonly TeamMember[]>;
  findByExternalIdentity(source: string, externalId: string): Promise<TeamMember | undefined>;
}

export interface MilestoneRepository {
  findById(id: MilestoneId): Promise<Milestone | undefined>;
  findByProject(projectId: ProjectId): Promise<readonly Milestone[]>;
  save(milestone: Milestone): Promise<void>;
  delete(id: MilestoneId): Promise<boolean>;
}

export interface TaskRepository extends EntityRepository<Task, TaskId> {
  findByProject(projectId: ProjectId): Promise<readonly Task[]>;
  findOpenByOwner(projectId: ProjectId, ownerId: TeamMemberId): Promise<readonly Task[]>;
  saveMany(tasks: readonly Task[]): Promise<void>;
}

export interface TaskDependencyRepository {
  findByProject(projectId: ProjectId): Promise<readonly TaskDependency[]>;
  save(dependency: TaskDependency): Promise<void>;
  delete(dependencyTaskId: TaskId, dependantTaskId: TaskId): Promise<boolean>;
}

export interface DecisionRepository extends EntityRepository<Decision, DecisionId> {
  findByProject(projectId: ProjectId): Promise<readonly Decision[]>;
}

export interface RiskRepository extends EntityRepository<Risk, RiskId> {
  findOpenByProject(projectId: ProjectId): Promise<readonly Risk[]>;
  replaceOpenForProject(projectId: ProjectId, risks: readonly Risk[]): Promise<void>;
}

export interface CheckpointRepository
  extends EntityRepository<ProjectCheckpoint, ProjectCheckpointId> {
  findByProject(projectId: ProjectId): Promise<readonly ProjectCheckpoint[]>;
}

export interface IntegrationRepository extends EntityRepository<Integration, IntegrationId> {
  findByProject(projectId: ProjectId): Promise<readonly Integration[]>;
}

export interface ProjectEventRepository {
  append(event: ProjectEvent): Promise<void>;
  hasProcessed(source: string, externalEventId: string): Promise<boolean>;
  markProcessed(source: string, externalEventId: string, eventId: ProjectEventId): Promise<void>;
  findByProject(
    projectId: ProjectId,
    options?: Readonly<{ after?: Date | undefined; limit?: number | undefined }>,
  ): Promise<readonly ProjectEvent[]>;
}

export interface ProjectMemoryRepository {
  load(projectId: ProjectId): Promise<ProjectMemory>;
  save(memory: ProjectMemory): Promise<void>;
}

export interface TransactionManager {
  transaction<TResult>(operation: () => Promise<TResult>): Promise<TResult>;
}

export interface DomainEventPublisher {
  publish(events: readonly ProjectEvent[]): Promise<void>;
}

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  generate(): string;
}

export interface UnitOfWork {
  readonly workspaces: WorkspaceRepository;
  readonly projects: ProjectRepository;
  readonly teamMembers: TeamMemberRepository;
  readonly milestones: MilestoneRepository;
  readonly tasks: TaskRepository;
  readonly taskDependencies: TaskDependencyRepository;
  readonly decisions: DecisionRepository;
  readonly risks: RiskRepository;
  readonly checkpoints: CheckpointRepository;
  readonly integrations: IntegrationRepository;
  readonly events: ProjectEventRepository;
  readonly memories: ProjectMemoryRepository;
  transaction<TResult>(operation: () => Promise<TResult>): Promise<TResult>;
}
