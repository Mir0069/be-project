// =============================================================================
// PROPOSAL REPOSITORY — MONGOOSE IMPLEMENTATION
// =============================================================================

import mongoose from 'mongoose';
import { StatusCodes } from 'http-status-codes';
import { AppError } from '@shared/errors/app.error';
import { ErrorCode } from '@shared/errors/error-codes';
import {
  ProposalModel,
  type IProposalDoc,
  type IProjectSchema,
  type IProjectVersion
} from '@db/models/proposal.model';
import type {
  IProposalRepository,
  IAppendVersionFields,
  IAppendRevisionFields,
  IExcelGenerationLogFields,
} from '../interfaces/i-proposal.repository';
import { createEmptySchema } from '@features/proposal/schema-registry';
import { stripFeedback } from '@features/proposal/feedback';

type LeanProposalDoc = IProposalDoc & { _id: mongoose.Types.ObjectId };

export class MongooseProposalRepository implements IProposalRepository {

  async findByProjectId(projectId: string): Promise<IProposalDoc | null> {
    const doc = await ProposalModel
      .findOne({ projectId: new mongoose.Types.ObjectId(projectId) })
      .lean<LeanProposalDoc>()
      .exec();

    if (!doc) return null;
    return doc as IProposalDoc;
  }

  async ensureProposalExists(projectId: string): Promise<IProposalDoc> {
    let doc = await ProposalModel
      .findOne({ projectId: new mongoose.Types.ObjectId(projectId) })
      .lean<LeanProposalDoc>()
      .exec();

    if (!doc) {
      const publicId = new mongoose.Types.ObjectId().toHexString();
      const emptySchema = createEmptySchema();
      
      const created = await ProposalModel.create({
        publicId,
        projectId: new mongoose.Types.ObjectId(projectId),
        schemaVersion: 'v4',
        schema: emptySchema,
        versions: {
          stage_0: [], stage_1: [], stage_2: [], stage_3: [], stage_4: [], stage_5: [], stage_6: []
        },
        revisions: {
          stage_0: [], stage_1: [], stage_2: [], stage_3: [], stage_4: [], stage_5: [], stage_6: [], stage_6_proposal: [], stage_7: []
        },
      });
      doc = await ProposalModel.findById(created._id).lean<LeanProposalDoc>().exec();
      if (!doc) throw new Error('Failed to create Proposal');
    }

    return doc as IProposalDoc;
  }

  async getCurrentSchema(projectId: string): Promise<IProjectSchema> {
    const doc = await ProposalModel
      .findOne({ projectId: new mongoose.Types.ObjectId(projectId) })
      .select('schema')
      .lean<{ schema: IProjectSchema }>()
      .exec();

    if (!doc) {
      throw new AppError('Proposal not found', StatusCodes.NOT_FOUND, true, { code: ErrorCode.NOT_FOUND });
    }
    return doc.schema;
  }

  async appendVersion(fields: IAppendVersionFields): Promise<IProposalDoc> {
    const doc = await ProposalModel.findOne({ projectId: new mongoose.Types.ObjectId(fields.projectId) }).exec();
    if (!doc) {
      throw new AppError('Proposal not found', StatusCodes.NOT_FOUND, true, { code: ErrorCode.NOT_FOUND });
    }

    const bucketKey = fields.versionKey ?? `stage_${fields.stage}`;

    let snapshotPayload: any;
    if (fields.versionKey) {
      snapshotPayload = JSON.parse(JSON.stringify((fields.nextSchema as any)[fields.versionKey]));
    } else if (fields.stage === 0) {
      snapshotPayload = JSON.parse(JSON.stringify(fields.nextSchema));
    } else {
      const stageKey = `stage_${fields.stage}` as keyof typeof fields.nextSchema;
      snapshotPayload = JSON.parse(JSON.stringify(fields.nextSchema[stageKey]));
      if (fields.stage === 2) {
        snapshotPayload.units = JSON.parse(JSON.stringify(fields.nextSchema.units || {}));
      }
    }
    stripFeedback(snapshotPayload);

    const newVersion: IProjectVersion = {
      timestamp: new Date(),
      source: fields.source,
      updatedBy: fields.updatedBy,
      snapshot: snapshotPayload,
    };

    // Apply the new schema to the document
    doc.set('schema', fields.nextSchema);

    const stageArrayName = bucketKey as keyof typeof doc.versions;
    if (!doc.versions[stageArrayName]) {
      doc.versions[stageArrayName] = [];
    }
    
    doc.versions[stageArrayName].push(newVersion);

    // Save with optimistic concurrency
    await doc.save();

    const updated = await ProposalModel.findById(doc._id).lean<LeanProposalDoc>().exec();
    return updated as IProposalDoc;
  }

  async getVersionHistory(projectId: string): Promise<IProjectVersion[]> {
    const doc = await this.findByProjectId(projectId);
    if (!doc) {
      throw new AppError('Proposal not found', StatusCodes.NOT_FOUND, true, { code: ErrorCode.NOT_FOUND });
    }
    // Flatten all versions into a single array, ordered by timestamp
    const allVersions: IProjectVersion[] = [];
    Object.values(doc.versions).forEach((stageArray: any) => {
      if (Array.isArray(stageArray)) {
        allVersions.push(...stageArray);
      }
    });
    return allVersions.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  async getVersion(projectId: string, _versionNumber: number): Promise<IProjectVersion | null> {
    const doc = await this.findByProjectId(projectId);
    if (!doc) {
      throw new AppError('Proposal not found', StatusCodes.NOT_FOUND, true, { code: ErrorCode.NOT_FOUND });
    }
    // We no longer have a numeric 'version' field. We can try to fetch by index if needed, but for now we'll throw an error if this is called since it's obsolete.
    throw new Error('getVersion by number is no longer supported with stage-based version arrays');
  }

  async logExcelGeneration(fields: IExcelGenerationLogFields): Promise<void> {
    const doc = await ProposalModel.findOne({ projectId: new mongoose.Types.ObjectId(fields.projectId) }).exec();
    if (!doc) {
       throw new AppError('Proposal not found', StatusCodes.NOT_FOUND, true, { code: ErrorCode.NOT_FOUND });
    }
    
    // We only need to update the stage_6_status, if we want.
    // The prompt says: "Stage 6 runs after Stage 5 is approved. Stage 6 is the Excel writer... No estimator review needed."
    // We can just update the pipeline status.
    doc.schema.pipeline_status.stage_6_status = 'APPROVED';
    doc.markModified('schema');
    
    // Also track in a version if we want, but the prompt only strictly says AI push and estimator edit creates version.
    await doc.save();
  }

  async appendRevision(fields: IAppendRevisionFields): Promise<IProposalDoc> {
    const doc = await ProposalModel.findOne({ projectId: new mongoose.Types.ObjectId(fields.projectId) }).exec();
    if (!doc) {
      throw new AppError('Proposal not found', StatusCodes.NOT_FOUND, true, { code: ErrorCode.NOT_FOUND });
    }

    // Legacy documents created before the revisions field existed won't have it.
    if (!doc.revisions) {
      doc.revisions = {
        stage_0: [], stage_1: [], stage_2: [], stage_3: [], stage_4: [], stage_5: [], stage_6: [], stage_7: [],
      } as any;
    }

    const revisionsKey = `stage_${fields.stage}` as keyof typeof doc.revisions;
    if (!doc.revisions[revisionsKey]) {
      doc.revisions[revisionsKey] = [];
    }

    doc.revisions[revisionsKey].push({
      reason: fields.reason ?? '',
      revisedBy: fields.revisedBy,
      revisedAt: new Date(),
      revisionNumber: doc.revisions[revisionsKey].length + 1,
    });

    await doc.save();

    const updated = await ProposalModel.findById(doc._id).lean<LeanProposalDoc>().exec();
    return updated as IProposalDoc;
  }
}
