import type {
  ITeamsProvisionCandidate,
  TeamsProvisionDecision,
  TeamsProvisionMode,
  TeamsProvisionStatus,
} from '@db/models/teams-provision-outbox.model';

export interface ITeamsProvisionJob {
  id: string;
  projectId: string;
  projectName: string;
  teamName: string;
  channelName: string;
  status: TeamsProvisionStatus;
  attempts: number;
  lastError: string | null;
  teamId: string | null;
  operationId: string | null;
  channelId: string | null;
  mode: TeamsProvisionMode | null;
  candidates: ITeamsProvisionCandidate[];
  discoveredAt: Date | null;
  discoveryError: string | null;
  decision: TeamsProvisionDecision | null;
  decidedAt: Date | null;
  createdAt: Date;
}

export interface IEnqueueProvisionFields {
  projectId: string;
  projectName: string;
  teamName: string;
  channelName: string;
}

// Partial checkpoint/status update applied as the drain progresses.
export interface IProvisionJobUpdate {
  status?: TeamsProvisionStatus;
  attempts?: number;
  lastError?: string | null;
  teamId?: string | null;
  operationId?: string | null;
  channelId?: string | null;
  projectName?: string;
  teamName?: string;
  channelName?: string;
  mode?: TeamsProvisionMode | null;
  candidates?: ITeamsProvisionCandidate[];
  discoveredAt?: Date | null;
  discoveryError?: string | null;
  decision?: TeamsProvisionDecision | null;
  decidedAt?: Date | null;
}

export interface ITeamsProvisionOutboxRepository {
  // Insert a job for the project if one doesn't already exist (idempotent — the
  // projectId is unique). Returns the current job either way.
  enqueue(fields: IEnqueueProvisionFields): Promise<ITeamsProvisionJob>;
  // Jobs the drain may act on. Parked (AWAITING_DECISION) jobs are excluded.
  listRunnable(): Promise<ITeamsProvisionJob[]>;
  listAwaitingDecision(): Promise<ITeamsProvisionJob[]>;
  findByProjectId(projectId: string): Promise<ITeamsProvisionJob | null>;
  update(id: string, patch: IProvisionJobUpdate): Promise<ITeamsProvisionJob | null>;
  // Conditional update, so a double-clicked decision is a deterministic no-op
  // instead of a second connect or a second create.
  updateIfStatus(
    id: string,
    expected: TeamsProvisionStatus,
    patch: IProvisionJobUpdate,
  ): Promise<ITeamsProvisionJob | null>;
}
