import type {
  TeamsProjectMemberReason,
  TeamsProjectMemberStatus,
} from '@db/models/teams-project-member.model';

export interface ITeamsProjectMemberRecord {
  id: string;
  projectId: string;
  userId: string;
  teamId: string | null;
  reason: TeamsProjectMemberReason;
  status: TeamsProjectMemberStatus;
  attempts: number;
  lastError: string | null;
  aadUserId: string | null;
  invited: boolean;
  notifiedAt: Date | null;
  createdAt: Date;
}

export interface IEnsureTeamsProjectMemberFields {
  projectId: string;
  userId: string;
  teamId: string | null;
  reason: TeamsProjectMemberReason;
}

export interface ITeamsProjectMemberUpdate {
  status?: TeamsProjectMemberStatus;
  attempts?: number;
  lastError?: string | null;
  aadUserId?: string | null;
  invited?: boolean;
  notifiedAt?: Date | null;
}

export interface ITeamsProjectAssigner {
  projectId: string;
  userId: string;
}

export interface ITeamsProjectMemberRepository {
  // Inserts only the rows that don't exist yet and returns how many were created.
  // Existing rows keep their status, so a re-sync never re-adds or resets anyone.
  ensureMany(rows: IEnsureTeamsProjectMemberFields[]): Promise<number>;
  // PENDING rows that already know their team, oldest first.
  listRunnable(limit: number): Promise<ITeamsProjectMemberRecord[]>;
  listAssigners(projectIds: string[]): Promise<ITeamsProjectAssigner[]>;
  update(id: string, patch: ITeamsProjectMemberUpdate): Promise<void>;
}
