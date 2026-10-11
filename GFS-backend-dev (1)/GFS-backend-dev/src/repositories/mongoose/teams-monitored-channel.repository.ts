import mongoose, { type HydratedDocument } from 'mongoose';
import {
  TeamsMonitoredChannel,
  type ITeamsMonitoredChannel,
} from '@db/models/teams-monitored-channel.model';
import type { TeamsAiSummary } from '@features/teams/teams-ai.types';
import type {
  ITeamsMonitoredChannelRepository,
  IDomainMonitoredChannel,
  ICreateMonitoredChannelFields,
} from '../interfaces/i-teams-monitored-channel.repository';

const toObjectIds = (ids: string[]): mongoose.Types.ObjectId[] =>
  ids.filter((id) => mongoose.Types.ObjectId.isValid(id)).map((id) => new mongoose.Types.ObjectId(id));

export class MongooseTeamsMonitoredChannelRepository
  implements ITeamsMonitoredChannelRepository
{
  public async listActive(): Promise<IDomainMonitoredChannel[]> {
    const docs = await TeamsMonitoredChannel.find({ isActive: true }).sort({ createdAt: -1 });
    return docs.map((d) => this.toDomain(d));
  }

  public async findById(id: string): Promise<IDomainMonitoredChannel | null> {
    const doc = await TeamsMonitoredChannel.findById(id);
    return doc ? this.toDomain(doc) : null;
  }

  public async findByChannel(
    teamId: string,
    channelId: string,
  ): Promise<IDomainMonitoredChannel | null> {
    const doc = await TeamsMonitoredChannel.findOne({ teamId, channelId });
    return doc ? this.toDomain(doc) : null;
  }

  public async listByProjectId(projectId: string): Promise<IDomainMonitoredChannel[]> {
    if (!mongoose.Types.ObjectId.isValid(projectId)) return [];
    const oid = new mongoose.Types.ObjectId(projectId);
    // Match the new array field or the legacy single field for un-migrated rows.
    const docs = await TeamsMonitoredChannel.find({
      isActive: true,
      $or: [{ projectIds: oid }, { projectId: oid }],
    }).sort({ createdAt: -1 });
    return docs.map((d) => this.toDomain(d));
  }

  public async listByProjectIds(projectIds: string[]): Promise<IDomainMonitoredChannel[]> {
    const oids = projectIds
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));
    if (oids.length === 0) return [];

    const docs = await TeamsMonitoredChannel.find({
      isActive: true,
      $or: [{ projectIds: { $in: oids } }, { projectId: { $in: oids } }],
    });
    return docs.map((d) => this.toDomain(d));
  }

  public async upsert(fields: ICreateMonitoredChannelFields): Promise<IDomainMonitoredChannel> {
    const doc = await TeamsMonitoredChannel.findOneAndUpdate(
      { teamId: fields.teamId, channelId: fields.channelId },
      {
        teamName: fields.teamName,
        channelName: fields.channelName,
        projectIds: toObjectIds(fields.projectIds ?? []),
        projectId: null, // legacy field is superseded by projectIds
        isActive: true,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    return this.toDomain(doc);
  }

  public async removeProjectLink(
    id: string,
    projectId: string,
  ): Promise<IDomainMonitoredChannel | null> {
    if (!mongoose.Types.ObjectId.isValid(projectId)) return null;
    const oid = new mongoose.Types.ObjectId(projectId);
    const existing = await TeamsMonitoredChannel.findById(id).select('projectId');
    const update: mongoose.UpdateQuery<ITeamsMonitoredChannel> = { $pull: { projectIds: oid } };
    // Also clear the legacy single field when it points at the same project.
    if (existing?.projectId && existing.projectId.equals(oid)) {
      update.$set = { projectId: null };
    }
    const doc = await TeamsMonitoredChannel.findByIdAndUpdate(id, update, { new: true });
    return doc ? this.toDomain(doc) : null;
  }

  public async updateDeltaLink(id: string, deltaLink: string | null): Promise<void> {
    await TeamsMonitoredChannel.updateOne({ _id: id }, { deltaLink });
  }

  public async setChatSummary(
    id: string,
    summary: TeamsAiSummary,
  ): Promise<IDomainMonitoredChannel | null> {
    if (!mongoose.Types.ObjectId.isValid(id)) return null;
    const doc = await TeamsMonitoredChannel.findByIdAndUpdate(
      id,
      { aiChatSummary: summary },
      { new: true },
    );
    return doc ? this.toDomain(doc) : null;
  }

  public async deleteById(id: string): Promise<IDomainMonitoredChannel | null> {
    const doc = await TeamsMonitoredChannel.findByIdAndDelete(id);
    return doc ? this.toDomain(doc) : null;
  }

  public async deactivate(id: string): Promise<void> {
    if (!mongoose.Types.ObjectId.isValid(id)) return;
    await TeamsMonitoredChannel.findByIdAndUpdate(id, {
      isActive: false,
      projectIds: [],
      projectId: null,
      // Drop the delta cursor: a later reconnect must re-import the whole
      // channel, not resume from where monitoring stopped.
      deltaLink: null,
    });
  }

  private toDomain(doc: HydratedDocument<ITeamsMonitoredChannel>): IDomainMonitoredChannel {
    // Prefer the array; fall back to the legacy single projectId for old rows.
    const ids = (doc.projectIds ?? []).map((p) => p.toString());
    if (ids.length === 0 && doc.projectId) ids.push(doc.projectId.toString());
    return {
      id: doc._id.toString(),
      teamId: doc.teamId,
      teamName: doc.teamName,
      channelId: doc.channelId,
      channelName: doc.channelName,
      projectIds: ids,
      deltaLink: doc.deltaLink ?? null,
      isActive: doc.isActive,
      aiChatSummary: doc.aiChatSummary
        ? {
            summary: doc.aiChatSummary.summary,
            keyPoints: doc.aiChatSummary.keyPoints ?? [],
            requirements: doc.aiChatSummary.requirements ?? [],
            confidence: doc.aiChatSummary.confidence ?? null,
            updatedAt: doc.aiChatSummary.updatedAt,
          }
        : null,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }
}
