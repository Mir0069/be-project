import mongoose, { type HydratedDocument } from 'mongoose';

import {
  TeamsProjectMember,
  type ITeamsProjectMember,
} from '@db/models/teams-project-member.model';
import type {
  IEnsureTeamsProjectMemberFields,
  ITeamsProjectAssigner,
  ITeamsProjectMemberRecord,
  ITeamsProjectMemberRepository,
  ITeamsProjectMemberUpdate,
} from '../interfaces/i-teams-project-member.repository';

const DUPLICATE_KEY_ERROR = 11000;

const keyOf = (projectId: string, userId: string, teamId: string | null): string =>
  `${projectId}:${userId}:${teamId ?? ''}`;

const toObjectIds = (ids: string[]): mongoose.Types.ObjectId[] =>
  ids.filter((id) => mongoose.Types.ObjectId.isValid(id)).map((id) => new mongoose.Types.ObjectId(id));

export class MongooseTeamsProjectMemberRepository implements ITeamsProjectMemberRepository {
  public async ensureMany(rows: IEnsureTeamsProjectMemberFields[]): Promise<number> {
    const valid = rows.filter(
      (row) => mongoose.Types.ObjectId.isValid(row.projectId) && mongoose.Types.ObjectId.isValid(row.userId),
    );
    if (valid.length === 0) return 0;

    const projectIds = [...new Set(valid.map((row) => row.projectId))];
    const existing = await TeamsProjectMember.find(
      { projectId: { $in: toObjectIds(projectIds) } },
      { projectId: 1, userId: 1, teamId: 1 },
    ).lean();
    const known = new Set(
      existing.map((row) => keyOf(row.projectId.toString(), row.userId.toString(), row.teamId ?? null)),
    );

    const missing = new Map<string, IEnsureTeamsProjectMemberFields>();
    for (const row of valid) {
      const key = keyOf(row.projectId, row.userId, row.teamId);
      if (!known.has(key) && !missing.has(key)) missing.set(key, row);
    }
    if (missing.size === 0) return 0;

    const docs = [...missing.values()].map((row) => ({
      projectId: new mongoose.Types.ObjectId(row.projectId),
      userId: new mongoose.Types.ObjectId(row.userId),
      teamId: row.teamId,
      reason: row.reason,
      status: row.teamId ? 'PENDING' : 'WAITING_FOR_TEAM',
    }));

    try {
      const inserted = await TeamsProjectMember.insertMany(docs, { ordered: false });
      return inserted.length;
    } catch (err) {
      // A concurrent sync may have inserted some rows first; those duplicates are fine.
      const writeErrors = (err as { writeErrors?: Array<{ code?: number; err?: { code?: number } }> }).writeErrors;
      const onlyDuplicates = Array.isArray(writeErrors) && writeErrors.every(
        (writeError) => (writeError.code ?? writeError.err?.code) === DUPLICATE_KEY_ERROR,
      );
      if (!onlyDuplicates) throw err;
      return docs.length - writeErrors.length;
    }
  }

  public async listRunnable(limit: number): Promise<ITeamsProjectMemberRecord[]> {
    const docs = await TeamsProjectMember.find({ status: 'PENDING', teamId: { $ne: null } })
      .sort({ createdAt: 1 })
      .limit(limit);
    return docs.map((doc) => this.toDomain(doc));
  }

  public async listAssigners(projectIds: string[]): Promise<ITeamsProjectAssigner[]> {
    if (projectIds.length === 0) return [];
    const docs = await TeamsProjectMember.find(
      { reason: 'ASSIGNER', projectId: { $in: toObjectIds(projectIds) } },
      { projectId: 1, userId: 1 },
    ).lean();
    const unique = new Map<string, ITeamsProjectAssigner>();
    for (const doc of docs) {
      const assigner = { projectId: doc.projectId.toString(), userId: doc.userId.toString() };
      unique.set(`${assigner.projectId}:${assigner.userId}`, assigner);
    }
    return [...unique.values()];
  }

  public async update(id: string, patch: ITeamsProjectMemberUpdate): Promise<void> {
    if (!mongoose.Types.ObjectId.isValid(id)) return;
    await TeamsProjectMember.findByIdAndUpdate(id, patch);
  }

  private toDomain(doc: HydratedDocument<ITeamsProjectMember>): ITeamsProjectMemberRecord {
    return {
      id: doc._id.toString(),
      projectId: doc.projectId.toString(),
      userId: doc.userId.toString(),
      teamId: doc.teamId ?? null,
      reason: doc.reason,
      status: doc.status,
      attempts: doc.attempts,
      lastError: doc.lastError ?? null,
      aadUserId: doc.aadUserId ?? null,
      invited: doc.invited,
      notifiedAt: doc.notifiedAt ?? null,
      createdAt: doc.createdAt,
    };
  }
}
