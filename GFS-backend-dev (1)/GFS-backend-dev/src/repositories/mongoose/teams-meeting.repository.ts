import mongoose, { type HydratedDocument } from 'mongoose';

import { TeamsMeeting, type ITeamsMeeting } from '@db/models/teams-meeting.model';
import type { TeamsAiSummary } from '@features/teams/teams-ai.types';
import type {
  ITeamsMeetingRepository,
  IDomainTeamsMeeting,
  IUpsertTeamsMeetingFields,
  IListTeamsMeetingsFilter,
  ITeamsMeetingPage,
} from '../interfaces/i-teams-meeting.repository';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 25;
// Max times a meeting is (re)dispatched to the AI. After this it stops retrying
// even if the summary is still empty, so a meeting can't loop forever.
const MAX_AI_ATTEMPTS = 3;

export class MongooseTeamsMeetingRepository implements ITeamsMeetingRepository {
  public async upsertByChannelEventMessageId(
    fields: IUpsertTeamsMeetingFields,
  ): Promise<IDomainTeamsMeeting> {
    const doc = await TeamsMeeting.findOneAndUpdate(
      { channelEventMessageId: fields.channelEventMessageId },
      { ...fields },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    return this.toDomain(doc);
  }

  public async findById(id: string): Promise<IDomainTeamsMeeting | null> {
    if (!mongoose.isValidObjectId(id)) return null;
    const doc = await TeamsMeeting.findById(id);
    return doc ? this.toDomain(doc) : null;
  }

  public async list(filter: IListTeamsMeetingsFilter): Promise<ITeamsMeetingPage> {
    const page = filter.page && filter.page > 0 ? filter.page : DEFAULT_PAGE;
    const limit = filter.limit && filter.limit > 0 ? filter.limit : DEFAULT_LIMIT;

    const query: Record<string, unknown> = {};
    if (filter.channelIds && filter.channelIds.length > 0) {
      query['channelId'] = { $in: filter.channelIds };
    } else if (filter.channelId) {
      query['channelId'] = filter.channelId;
    } else if (filter.projectId) {
      query['projectId'] = filter.projectId;
    }
    if (filter.monitoredChannelDbId) query['monitoredChannelDbId'] = filter.monitoredChannelDbId;

    const [docs, total] = await Promise.all([
      TeamsMeeting.find(query)
        .sort({ startDateTime: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      TeamsMeeting.countDocuments(query),
    ]);

    return { meetings: docs.map((d) => this.toDomain(d)), total };
  }

  public async listUnsentByChannelId(channelId: string): Promise<IDomainTeamsMeeting[]> {
    const docs = await TeamsMeeting.find({
      channelId,
      $or: [
        // Never dispatched.
        { sentToAI: { $ne: true } },
        // Already dispatched but has a transcript and still no usable summary
        // (e.g. the transcript SAS expired before the AI read it) — retry, but
        // only up to MAX_AI_ATTEMPTS so it can't loop forever.
        {
          hasTranscript: true,
          $and: [
            { $or: [{ aiSummary: null }, { 'aiSummary.summary': { $in: ['', null] } }] },
            { $or: [{ aiAttempts: { $exists: false } }, { aiAttempts: { $lt: MAX_AI_ATTEMPTS } }] },
          ],
        },
      ],
    }).sort({ startDateTime: 1 });
    return docs.map((d) => this.toDomain(d));
  }

  public async markSentToAI(id: string): Promise<void> {
    if (!mongoose.isValidObjectId(id)) return;
    await TeamsMeeting.updateOne(
      { _id: id },
      { $set: { sentToAI: true }, $inc: { aiAttempts: 1 } },
    );
  }

  public async setAiSummary(
    id: string,
    summary: TeamsAiSummary,
  ): Promise<IDomainTeamsMeeting | null> {
    if (!mongoose.isValidObjectId(id)) return null;
    const doc = await TeamsMeeting.findByIdAndUpdate(id, { aiSummary: summary }, { new: true });
    return doc ? this.toDomain(doc) : null;
  }

  private toDomain(doc: HydratedDocument<ITeamsMeeting>): IDomainTeamsMeeting {
    return {
      id: doc._id.toString(),
      channelEventMessageId: doc.channelEventMessageId,
      callId: doc.callId ?? null,
      meetingId: doc.meetingId ?? null,
      subject: doc.subject ?? null,
      startDateTime: doc.startDateTime ?? null,
      teamId: doc.teamId ?? null,
      channelId: doc.channelId ?? null,
      monitoredChannelDbId: doc.monitoredChannelDbId
        ? doc.monitoredChannelDbId.toString()
        : null,
      projectId: doc.projectId ? doc.projectId.toString() : null,
      transcriptId: doc.transcriptId ?? null,
      participantNames: doc.participantNames ?? [],
      participantCount: doc.participantCount ?? 0,
      messageCount: doc.messageCount ?? 0,
      documentCount: doc.documentCount ?? 0,
      hasTranscript: doc.hasTranscript ?? false,
      lastRecordedAt: doc.lastRecordedAt,
      sentToAI: doc.sentToAI ?? false,
      aiSummary: doc.aiSummary
        ? {
            summary: doc.aiSummary.summary,
            keyPoints: doc.aiSummary.keyPoints ?? [],
            requirements: doc.aiSummary.requirements ?? [],
            confidence: doc.aiSummary.confidence ?? null,
            updatedAt: doc.aiSummary.updatedAt,
          }
        : null,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }
}
