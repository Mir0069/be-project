import type mongoose from 'mongoose';
import type { ProjectStatus, ProjectAnalysisStatus, ProjectType, ProjectCreationSource, IProjectAddress, IProjectExternalContact, IProjectRevisionRequest, IProjectActiveRetrigger } from '@db/models/project.model';

export interface ICreateProjectFields {
  referenceNumber: string;
  projectName: string;
  customerName: string;
  projectType: ProjectType;
  creationSource?: ProjectCreationSource;
  status?: ProjectStatus;
  analysisStatus?: ProjectAnalysisStatus;
  identifierHash?: string | null;
  zohoLeadId?: string | null;
  jobAddress?: string | null;
  quoteNumber?: string | null;
  leadStatus?: string | null;
  blobStorageURL?: string | null;
  zohoOpportunityId?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  company?: string | null;
  customerWebsite?: string | null;
  description?: string | null;
  externalContacts?: IProjectExternalContact[];
  receivedDate?: Date | null;
  address?: IProjectAddress | null;
  assignedEstimators?: mongoose.Types.ObjectId[] | string[];
  dueDate?: Date;
  isActive?: boolean;
  groupId?: string | null;
  isCompetitiveBid?: boolean;
  relatedProjectIds?: mongoose.Types.ObjectId[];
  partnerName?: string | null;
  revisionRequest?: IProjectRevisionRequest | null;
}

export interface IUpdateProjectFields {
  status?: ProjectStatus;
  analysisStatus?: ProjectAnalysisStatus;
  projectName?: string;
  customerName?: string;
  identifierHash?: string | null;
  zohoLeadId?: string | null;
  jobAddress?: string | null;
  quoteNumber?: string | null;
  leadStatus?: string | null;
  blobStorageURL?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  company?: string | null;
  customerWebsite?: string | null;
  description?: string | null;
  externalContacts?: IProjectExternalContact[];
  receivedDate?: Date | null;
  address?: IProjectAddress | null;
  assignedEstimators?: mongoose.Types.ObjectId[] | string[];
  lastZohoSyncedAt?: Date | null;
  crmContextHash?: string | null;
  crmContextSentAt?: Date | null;
  activeRetrigger?: IProjectActiveRetrigger | null;
  dueDate?: Date;
  isActive?: boolean;
  estimatedCost?: number | null;
  totalSqFt?: number | null;
  dropboxFolderPath?: string | null;
  groupId?: string | null;
  isCompetitiveBid?: boolean;
  relatedProjectIds?: mongoose.Types.ObjectId[];
  partnerName?: string | null;
  revisionRequest?: IProjectRevisionRequest | null;
}

export interface IAssignedEstimator {
  id: string;
  name: string;
  email: string;
  status?: string;
}

export interface IDomainProject {
  id: string;
  referenceNumber: string;
  projectName: string;
  customerName: string;
  status: ProjectStatus;
  analysisStatus?: ProjectAnalysisStatus;
  projectType: ProjectType;
  creationSource: ProjectCreationSource;
  identifierHash: string | null;
  zohoLeadId: string | null;
  jobAddress: string | null;
  quoteNumber: string | null;
  leadStatus: string | null;
  blobStorageURL: string | null;
  dropboxFolderPath: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  company: string | null;
  customerWebsite: string | null;
  description: string | null;
  externalContacts?: IProjectExternalContact[];
  receivedDate: Date | null;
  address: IProjectAddress | null;
  assignedEstimators?: IAssignedEstimator[];
  estimatorName?: string | null;
  lastZohoSyncedAt: Date | null;
  crmContextHash?: string | null;
  crmContextSentAt?: Date | null;
  activeRetrigger?: IProjectActiveRetrigger | null;
  dueDate?: Date;
  isActive: boolean;
  estimatedCost: number | null;
  totalSqFt: number | null;
  createdAt: Date;
  updatedAt: Date;
  groupId?: string | null;
  isCompetitiveBid?: boolean;
  relatedProjectIds?: string[];
  partnerName?: string | null;
  revisionRequest?: IProjectRevisionRequest | null;
}

// `PENDING` was used by older project records before the workflow statuses
// were split into WAITING_FOR_INPUTS and READY_FOR_ESTIMATOR. Keep it valid
// for read filters so those records remain discoverable without requiring an
// immediate database migration.
export type StoredProjectStatus = ProjectStatus | 'PENDING';

export interface IProjectListQuery {
  page: number;
  limit: number;
  statuses?: StoredProjectStatus[];
  analysisStatuses?: ProjectAnalysisStatus[];
  excludeAnalysisStatuses?: ProjectAnalysisStatus[];
  projectType?: ProjectType;
  customerName?: string;
  assignedEstimatorIds?: string[];
  referenceNumber?: string;
  search?: string;
  updatedAfter?: Date;
  sortBy: 'createdAt' | 'updatedAt' | 'dueDate' | 'projectName' | 'customerName';
  sortOrder: 'asc' | 'desc';
}

export interface IProjectListResult {
  data: IDomainProject[];
  total: number;
}

export interface IProjectRepository {
  findById(id: string): Promise<IDomainProject | null>;
  findByReferenceNumber(ref: string): Promise<IDomainProject | null>;
  findByZohoLeadId(zohoLeadId: string): Promise<IDomainProject | null>;
  findByGroupId?(groupId: string): Promise<IDomainProject[]>;
  listActive(): Promise<IDomainProject[]>;
  listActiveCursor?(): AsyncIterable<IDomainProject>;
  listActivePaginated?(query: IProjectListQuery): Promise<IProjectListResult>;
  create(fields: ICreateProjectFields): Promise<IDomainProject>;
  updateById(id: string, fields: IUpdateProjectFields): Promise<IDomainProject | null>;

  /**
   * Hard-deletes a project. Exists for ONE purpose: compensating rollback of a
   * create whose dependent write failed, where the project is seconds old and
   * nothing references it yet. Never use it to remove a project a user owns —
   * that is a soft delete (`isActive: false`) so history survives.
   */
  deleteById(id: string): Promise<boolean>;
  // Contact snapshots must not make an otherwise unchanged project look newly updated.
  updateExternalContacts?(id: string, contacts: IProjectExternalContact[]): Promise<IDomainProject | null>;
}
