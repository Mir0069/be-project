import mongoose, { type HydratedDocument } from 'mongoose';

import {
  TeamsProvisionOutbox,
  type ITeamsProvisionOutbox,
  type TeamsProvisionStatus,
} from '@db/models/teams-provision-outbox.model';
import type {
  IEnqueueProvisionFields,
  IProvisionJobUpdate,
  ITeamsProvisionJob,
  ITeamsProvisionOutboxRepository,
} from '../interfaces/i-teams-provision-outbox.repository';

export class MongooseTeamsProvisionOutboxRepository
  implements ITeamsProvisionOutboxRepository
{
  public async enqueue(fields: IEnqueueProvisionFields): Promise<ITeamsProvisionJob> {
    const doc = await TeamsProvisionOutbox.findOneAndUpdate(
      { projectId: new mongoose.Types.ObjectId(fields.projectId) },
      {
        $setOnInsert: {
          projectName: fields.projectName,
          teamName: fields.teamName,
          channelName: fields.channelName,
          status: 'PENDING',
          attempts: 0,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    return this.toDomain(doc);
  }

  public async listRunnable(): Promise<ITeamsProvisionJob[]> {
    const docs = await TeamsProvisionOutbox.find({
      status: { $in: ['PENDING', 'CREATING'] },
    }).sort({ createdAt: 1 });
    return docs.map((d) => this.toDomain(d));
  }

  public async listAwaitingDecision(): Promise<ITeamsProvisionJob[]> {
    const docs = await TeamsProvisionOutbox.find({ status: 'AWAITING_DECISION' }).sort({ createdAt: 1 });
    return docs.map((d) => this.toDomain(d));
  }

  public async findByProjectId(projectId: string): Promise<ITeamsProvisionJob | null> {
    if (!mongoose.Types.ObjectId.isValid(projectId)) return null;
    const doc = await TeamsProvisionOutbox.findOne({
      projectId: new mongoose.Types.ObjectId(projectId),
    });
    return doc ? this.toDomain(doc) : null;
  }

  public async update(
    id: string,
    patch: IProvisionJobUpdate,
  ): Promise<ITeamsProvisionJob | null> {
    if (!mongoose.Types.ObjectId.isValid(id)) return null;
    const doc = await TeamsProvisionOutbox.findByIdAndUpdate(id, patch, { new: true });
    return doc ? this.toDomain(doc) : null;
  }

  public async updateIfStatus(
    id: string,
    expected: TeamsProvisionStatus,
    patch: IProvisionJobUpdate,
  ): Promise<ITeamsProvisionJob | null> {
    if (!mongoose.Types.ObjectId.isValid(id)) return null;
    const doc = await TeamsProvisionOutbox.findOneAndUpdate(
      { _id: new mongoose.Types.ObjectId(id), status: expected },
      patch,
      { new: true },
    );
    return doc ? this.toDomain(doc) : null;
  }

  private toDomain(doc: HydratedDocument<ITeamsProvisionOutbox>): ITeamsProvisionJob {
    return {
      id: doc._id.toString(),
      projectId: doc.projectId.toString(),
      projectName: doc.projectName,
      teamName: doc.teamName,
      channelName: doc.channelName,
      status: doc.status,
      attempts: doc.attempts,
      lastError: doc.lastError ?? null,
      teamId: doc.teamId ?? null,
      operationId: doc.operationId ?? null,
      channelId: doc.channelId ?? null,
      mode: doc.mode ?? null,
      // Flatten the Mongoose subdocument array; the raw one carries internals
      // that must not cross the repository boundary.
      candidates: (doc.candidates ?? []).map((c) => ({
        teamId: c.teamId,
        teamName: c.teamName,
        channelId: c.channelId,
        channelName: c.channelName,
        score: c.score,
        reason: c.reason,
      })),
      discoveredAt: doc.discoveredAt ?? null,
      discoveryError: doc.discoveryError ?? null,
      decision: doc.decision ?? null,
      decidedAt: doc.decidedAt ?? null,
      createdAt: doc.createdAt,
    };
  }
}
