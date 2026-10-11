import mongoose, { type HydratedDocument } from 'mongoose';

import { TeamsAiJob, type ITeamsAiJob } from '@db/models/teams-ai-job.model';
import { TEAMS_AI_CORRELATION_PREFIX } from '@features/teams/teams-ai.types';
import type {
  ITeamsAiJobRepository,
  IDomainTeamsAiJob,
  ICreateTeamsAiJobFields,
  ICompleteTeamsAiJobFields,
} from '../interfaces/i-teams-ai-job.repository';

export class MongooseTeamsAiJobRepository implements ITeamsAiJobRepository {
  public async create(fields: ICreateTeamsAiJobFields): Promise<IDomainTeamsAiJob> {
    // Mint the id up-front so the correlationId (echoed by the AI) is stored on
    // the very row it identifies — no second write.
    const _id = new mongoose.Types.ObjectId();
    const doc = await TeamsAiJob.create({
      _id,
      correlationId: `${TEAMS_AI_CORRELATION_PREFIX}:${_id.toString()}`,
      projectId: fields.projectId,
      teamId: fields.teamId,
      channelId: fields.channelId,
      monitoredChannelDbId: fields.monitoredChannelDbId ?? null,
      messageIds: fields.messageIds,
      meetingDbIds: fields.meetingDbIds,
      documentIds: fields.documentIds,
      hasChat: fields.hasChat,
      meetingCount: fields.meetingCount,
      status: 'SENT',
      sentAt: fields.sentAt,
    });
    return this.toDomain(doc);
  }

  public async findById(id: string): Promise<IDomainTeamsAiJob | null> {
    if (!mongoose.isValidObjectId(id)) return null;
    const doc = await TeamsAiJob.findById(id);
    return doc ? this.toDomain(doc) : null;
  }

  public async findByCorrelationId(correlationId: string): Promise<IDomainTeamsAiJob | null> {
    const doc = await TeamsAiJob.findOne({ correlationId });
    return doc ? this.toDomain(doc) : null;
  }

  public async complete(
    id: string,
    fields: ICompleteTeamsAiJobFields,
  ): Promise<IDomainTeamsAiJob | null> {
    if (!mongoose.isValidObjectId(id)) return null;
    const doc = await TeamsAiJob.findByIdAndUpdate(
      id,
      {
        status: 'COMPLETED',
        readinessState: fields.readinessState ?? null,
        results: fields.results,
        completedAt: new Date(),
        error: null,
      },
      { new: true },
    );
    return doc ? this.toDomain(doc) : null;
  }

  public async markFailed(id: string, error: string): Promise<void> {
    if (!mongoose.isValidObjectId(id)) return;
    await TeamsAiJob.updateOne({ _id: id }, { status: 'FAILED', error });
  }

  private toDomain(doc: HydratedDocument<ITeamsAiJob>): IDomainTeamsAiJob {
    return {
      id: doc._id.toString(),
      correlationId: doc.correlationId,
      projectId: doc.projectId.toString(),
      teamId: doc.teamId,
      channelId: doc.channelId,
      monitoredChannelDbId: doc.monitoredChannelDbId
        ? doc.monitoredChannelDbId.toString()
        : null,
      messageIds: doc.messageIds ?? [],
      meetingDbIds: doc.meetingDbIds ?? [],
      documentIds: doc.documentIds ?? [],
      hasChat: doc.hasChat ?? false,
      meetingCount: doc.meetingCount ?? 0,
      status: doc.status,
      readinessState: doc.readinessState ?? null,
      results: doc.results ?? [],
      sentAt: doc.sentAt,
      completedAt: doc.completedAt ?? null,
      error: doc.error ?? null,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }
}
