import type { HydratedDocument } from 'mongoose';

import {
  TeamsTranscript,
  type ITeamsTranscript,
  type TeamsTranscriptLinkMethod,
} from '@db/models/teams-transcript.model';
import type {
  ITeamsTranscriptRepository,
  IDomainTeamsTranscript,
  IUpsertTeamsTranscriptFields,
  IListTeamsTranscriptsFilter,
  ITeamsTranscriptPage,
} from '../interfaces/i-teams-transcript.repository';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 25;

export class MongooseTeamsTranscriptRepository implements ITeamsTranscriptRepository {
  public async upsertByTranscriptId(
    fields: IUpsertTeamsTranscriptFields,
  ): Promise<IDomainTeamsTranscript> {
    const doc = await TeamsTranscript.findOneAndUpdate(
      { transcriptId: fields.transcriptId },
      { ...fields },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    return this.toDomain(doc);
  }

  public async findByTranscriptId(transcriptId: string): Promise<IDomainTeamsTranscript | null> {
    const doc = await TeamsTranscript.findOne({ transcriptId });
    return doc ? this.toDomain(doc) : null;
  }

  public async list(filter: IListTeamsTranscriptsFilter): Promise<ITeamsTranscriptPage> {
    const page = filter.page && filter.page > 0 ? filter.page : DEFAULT_PAGE;
    const limit = filter.limit && filter.limit > 0 ? filter.limit : DEFAULT_LIMIT;

    const query: Record<string, unknown> = {};
    if (filter.projectId) query['projectId'] = filter.projectId;
    if (filter.meetingId) query['meetingId'] = filter.meetingId;
    if (filter.monitoredChannelDbId) query['monitoredChannelDbId'] = filter.monitoredChannelDbId;
    if (filter.channelId) query['channelId'] = filter.channelId;

    const [docs, total] = await Promise.all([
      TeamsTranscript.find(query)
        .sort({ fetchedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      TeamsTranscript.countDocuments(query),
    ]);

    return { transcripts: docs.map((d) => this.toDomain(d)), total };
  }

  public async setProject(
    transcriptId: string,
    projectId: string,
    linkMethod: TeamsTranscriptLinkMethod,
  ): Promise<IDomainTeamsTranscript | null> {
    const doc = await TeamsTranscript.findOneAndUpdate(
      { transcriptId },
      { projectId, linkMethod },
      { new: true },
    );
    return doc ? this.toDomain(doc) : null;
  }

  public async markRoutedToPipeline(transcriptId: string): Promise<void> {
    await TeamsTranscript.updateOne({ transcriptId }, { routedToPipeline: true });
  }

  private toDomain(doc: HydratedDocument<ITeamsTranscript>): IDomainTeamsTranscript {
    return {
      id: doc._id.toString(),
      transcriptId: doc.transcriptId,
      meetingId: doc.meetingId,
      userId: doc.userId,
      meetingSubject: doc.meetingSubject ?? null,
      meetingJoinUrl: doc.meetingJoinUrl ?? null,
      contentVtt: doc.contentVtt,
      contentText: doc.contentText,
      byteSize: doc.byteSize,
      transcriptCreatedDateTime: doc.transcriptCreatedDateTime ?? null,
      projectId: doc.projectId ? doc.projectId.toString() : null,
      linkMethod: doc.linkMethod ?? null,
      routedToPipeline: doc.routedToPipeline,
      monitoredChannelDbId: doc.monitoredChannelDbId
        ? doc.monitoredChannelDbId.toString()
        : null,
      teamId: doc.teamId ?? null,
      channelId: doc.channelId ?? null,
      discoveredVia: doc.discoveredVia ?? null,
      fetchedAt: doc.fetchedAt,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }
}
