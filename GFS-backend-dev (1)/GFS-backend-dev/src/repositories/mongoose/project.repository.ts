import { Project } from '@db/models/project.model';
import '@db/models/user.model';
import type { Types } from 'mongoose';
import type {
  IProjectRepository,
  ICreateProjectFields,
  IUpdateProjectFields,
  IDomainProject,
  IProjectListQuery,
  IProjectListResult,
} from '@repositories/interfaces/i-project.repository';
import type { IProjectExternalContact } from '@db/models/project.model';

export class MongooseProjectRepository implements IProjectRepository {
  public async findById(id: string): Promise<IDomainProject | null> {
    const project = await Project.findById(id).populate('assignedEstimators', 'firstName lastName email status isActive');
    return project ? this.toDomain(project) : null;
  }

  public async findByReferenceNumber(ref: string): Promise<IDomainProject | null> {
    const project = await Project.findOne({ referenceNumber: ref }).populate('assignedEstimators', 'firstName lastName email status isActive');
    return project ? this.toDomain(project) : null;
  }

  public async findByZohoLeadId(zohoLeadId: string): Promise<IDomainProject | null> {
    const project = await Project.findOne({ zohoLeadId }).populate('assignedEstimators', 'firstName lastName email status isActive');
    return project ? this.toDomain(project) : null;
  }

  public async findByGroupId(groupId: string): Promise<IDomainProject[]> {
    const projects = await Project.find({ groupId, isActive: true })
      .populate('assignedEstimators', 'firstName lastName email status isActive');
    return projects.map((project) => this.toDomain(project));
  }

  public async listActive(): Promise<IDomainProject[]> {
    const projects = await Project.find({ isActive: true }).populate('assignedEstimators', 'firstName lastName email status isActive');
    return projects.map((project) => this.toDomain(project));
  }

  public async *listActiveCursor(): AsyncIterable<IDomainProject> {
    const cursor = Project.find({ isActive: true })
      .populate('assignedEstimators', 'firstName lastName email status isActive')
      .cursor();
    for await (const doc of cursor) {
      yield this.toDomain(doc);
    }
  }

  public async listActivePaginated(query: IProjectListQuery): Promise<IProjectListResult> {
    const filter: Record<string, any> = { isActive: true };
    if (query.statuses?.length) filter['status'] = { $in: query.statuses };
    if (query.analysisStatuses?.length) filter['analysisStatus'] = { $in: query.analysisStatuses };
    if (query.excludeAnalysisStatuses?.length) filter['analysisStatus'] = { $nin: query.excludeAnalysisStatuses };
    if (query.projectType) filter['projectType'] = query.projectType;
    if (query.customerName) filter['customerName'] = { $regex: escapeRegex(query.customerName), $options: 'i' };
    if (query.assignedEstimatorIds?.length) filter['assignedEstimators'] = { $in: query.assignedEstimatorIds };
    if (query.referenceNumber) filter['referenceNumber'] = { $regex: escapeRegex(query.referenceNumber), $options: 'i' };
    if (query.updatedAfter) filter['updatedAt'] = { $gte: query.updatedAfter };

    if (query.search) {
      const search = { $regex: escapeRegex(query.search), $options: 'i' };
      filter['$or'] = [
        { projectName: search },
        { customerName: search },
        { referenceNumber: search },
        { jobAddress: search },
        { 'address.street': search },
        { 'address.city': search },
        { 'address.state': search },
        { 'address.zipcode': search },
      ];
    }

    const sortDirection = query.sortOrder === 'asc' ? 1 : -1;
    if (query.sortBy === 'projectName' || query.sortBy === 'customerName') {
      // Cosmos does not support find() collation, so normalize text in an
      // aggregation to keep alphabetic sorting case-insensitive.
      const [pageRows, total] = await Promise.all([
        Project.aggregate<{ _id: Types.ObjectId }>([
          { $match: filter },
          {
            $addFields: {
              normalizedSortValue: {
                $toLower: { $ifNull: [`$${query.sortBy}`, ''] },
              },
            },
          },
          { $sort: { normalizedSortValue: sortDirection, _id: 1 } },
          { $skip: (query.page - 1) * query.limit },
          { $limit: query.limit },
          { $project: { _id: 1 } },
        ]),
        Project.countDocuments(filter),
      ]);

      const orderedIds = pageRows.map((row) => row._id);
      const projects = await Project.find({ _id: { $in: orderedIds } })
        .populate('assignedEstimators', 'firstName lastName email status isActive');
      const projectsById = new Map(projects.map((project) => [project._id.toString(), project]));

      return {
        data: orderedIds
          .map((id) => projectsById.get(id.toString()))
          .filter((project): project is NonNullable<typeof project> => Boolean(project))
          .map((project) => this.toDomain(project)),
        total,
      };
    }

    const [projects, total] = await Promise.all([
      Project.find(filter)
        .sort({ [query.sortBy]: sortDirection, _id: 1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .populate('assignedEstimators', 'firstName lastName email status isActive'),
      Project.countDocuments(filter),
    ]);

    return {
      data: projects.map((project) => this.toDomain(project)),
      total,
    };
  }

  public async create(fields: ICreateProjectFields): Promise<IDomainProject> {
    const project = await Project.create(fields);
    await project.populate('assignedEstimators', 'firstName lastName email status isActive');
    return this.toDomain(project);
  }

  public async updateById(id: string, fields: IUpdateProjectFields): Promise<IDomainProject | null> {
    const project = await Project.findByIdAndUpdate(id, fields, { new: true }).populate('assignedEstimators', 'firstName lastName email status isActive');
    return project ? this.toDomain(project) : null;
  }

  /** See IProjectRepository.deleteById — compensating rollback only. */
  public async deleteById(id: string): Promise<boolean> {
    const res = await Project.deleteOne({ _id: id });
    return res.deletedCount === 1;
  }

  public async updateExternalContacts(
    id: string,
    contacts: IProjectExternalContact[],
  ): Promise<IDomainProject | null> {
    const project = await Project.findByIdAndUpdate(
      id,
      { $set: { externalContacts: contacts } },
      { new: true, timestamps: false },
    ).populate('assignedEstimators', 'firstName lastName email status isActive');
    return project ? this.toDomain(project) : null;
  }

  private toDomain(project: any): IDomainProject {
    return {
      id: project._id.toString(),
      referenceNumber: project.referenceNumber,
      projectName: project.projectName,
      customerName: project.customerName,
      status: project.status,
      analysisStatus: project.analysisStatus ?? 'NOT_STARTED',
      projectType: project.projectType,
      creationSource: project.creationSource,
      identifierHash: project.identifierHash ?? null,
      zohoLeadId: project.zohoLeadId ?? null,
      jobAddress: project.jobAddress ?? null,
      quoteNumber: project.quoteNumber ?? null,
      leadStatus: project.leadStatus ?? null,
      blobStorageURL: project.blobStorageURL ?? null,
      dropboxFolderPath: project.dropboxFolderPath ?? null,
      customerEmail: project.customerEmail ?? null,
      customerPhone: project.customerPhone ?? null,
      company: project.company ?? null,
      customerWebsite: project.customerWebsite ?? null,
      description: project.description ?? null,
      externalContacts: (project.externalContacts ?? []).map((contact: any) => ({
        email: contact.email,
        name: contact.name ?? null,
        sources: contact.sources ?? [],
        firstSeenAt: contact.firstSeenAt,
        lastSeenAt: contact.lastSeenAt,
      })),
      receivedDate: project.receivedDate ?? null,
      address: project.address
        ? {
            street: project.address.street ?? null,
            city: project.address.city ?? null,
            state: project.address.state ?? null,
            zipcode: project.address.zipcode ?? null,
            country: project.address.country ?? null,
          }
        : null,
      lastZohoSyncedAt: project.lastZohoSyncedAt ?? null,
      crmContextHash: project.crmContextHash ?? null,
      crmContextSentAt: project.crmContextSentAt ?? null,
      activeRetrigger: project.activeRetrigger ?? null,
      assignedEstimators: (project.assignedEstimators || []).map((e: any) => ({
        id: e._id ? e._id.toString() : e.toString(),
        name: e.firstName ? `${e.firstName} ${e.lastName || ''}`.trim() : 'Unknown Estimator',
        email: e.email || '',
        status: e.isActive ? 'Active' : 'Inactive',
      })),
      estimatorName: project.estimatorName ?? null,
      isActive: project.isActive,
      dueDate: project.dueDate ?? undefined,
      estimatedCost: project.estimatedCost ?? null,
      totalSqFt: project.totalSqFt ?? null,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      groupId: project.groupId ?? null,
      isCompetitiveBid: project.isCompetitiveBid ?? false,
      relatedProjectIds: (project.relatedProjectIds ?? []).map((id: any) => id.toString()),
      partnerName: project.partnerName ?? null,
      revisionRequest: project.revisionRequest
        ? {
            stage: project.revisionRequest.stage,
            reason: project.revisionRequest.reason ?? null,
            requestedBy: project.revisionRequest.requestedBy,
            requestedAt: project.revisionRequest.requestedAt,
          }
        : null,
    };
  }
}

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
