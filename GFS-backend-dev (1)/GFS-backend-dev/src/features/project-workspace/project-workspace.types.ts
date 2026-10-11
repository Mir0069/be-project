import { z } from 'zod';
import { ProjectStatus, ProjectAnalysisStatus, ProjectType, ProjectCreationSource, IProjectAddress, IProjectExternalContact, IProjectRevisionRequest, ExternalContactSource } from '@db/models/project.model';

// Re-export so other workspace files don't break
export { ProjectStatus, ProjectAnalysisStatus, ProjectType, ProjectCreationSource };
export type { IProjectAddress };

export interface IProjectWorkspace {
  id: string;
  referenceNumber: string;
  blobStorageURL?: string | null;
  projectName: string;
  customerName: string;
  status: ProjectStatus;
  analysisStatus?: ProjectAnalysisStatus;
  projectType: ProjectType;
  creationSource?: ProjectCreationSource;

  identifierHash?: string | null;
  zohoLeadId?: string | null;
  jobAddress?: string | null;
  quoteNumber?: string | null;
  leadStatus?: string | null;

  assignedEstimators?: Array<{
    id: string;
    name: string;
    email: string;
  }>;
  customerEmail?: string | null;
  customerPhone?: string | null;
  company?: string | null;
  customerWebsite?: string | null;
  description?: string | null;
  externalContacts?: IProjectExternalContact[];
  receivedDate?: Date | null;
  address?: IProjectAddress | null;
  estimatorName?: string | null;
  estimatorEmail?: string | null;
  estimatorPhone?: string | null;
  lastZohoSyncedAt?: Date | null;
  dueDate?: Date;
  estimatedCost?: number | null;
  totalSqFt?: number | null;
  revisionRequest?: IProjectRevisionRequest | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IPaginationOptions {
  page?: number;
  limit?: number;
  sortBy?: 'createdAt' | 'updatedAt' | 'dueDate' | 'projectName' | 'customerName';
  sortOrder?: 'asc' | 'desc';
}

export interface IProjectFilter {
  status?: ProjectStatus;
  statusCategory?: 'NOT_STARTED' | 'PENDING' | 'AI_PROCESSING' | 'READY_FOR_ESTIMATOR' | 'IN_PROGRESS' | 'NEEDS_REVISION' | 'COMPLETED';
  projectType?: ProjectType;
  customerName?: string;
  assignedEstimatorIds?: string[];
  isActive?: boolean;
  referenceNumber?: string;
  dueDate?: string;
  search?: string;
  updatedAfter?: string;
}

export interface IPaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export type { IProjectExternalContact, ExternalContactSource };

export const ALLOWED_TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
  [ProjectStatus.SETUP_PENDING]: [ProjectStatus.WAITING_FOR_INPUTS, ProjectStatus.READY_FOR_ESTIMATOR],
  [ProjectStatus.WAITING_FOR_INPUTS]: [ProjectStatus.READY_FOR_ESTIMATOR],
  [ProjectStatus.READY_FOR_ESTIMATOR]: [ProjectStatus.ESTIMATOR_DRAFTING],
  [ProjectStatus.ESTIMATOR_DRAFTING]: [ProjectStatus.ESTIMATOR_FINAL, ProjectStatus.WAITING_FOR_INPUTS, ProjectStatus.NEEDS_REVISION],
  [ProjectStatus.ESTIMATOR_FINAL]: [ProjectStatus.ADMIN_PACKAGING, ProjectStatus.NEEDS_REVISION],
  [ProjectStatus.ADMIN_PACKAGING]: [ProjectStatus.NEEDS_REVISION],
  [ProjectStatus.NEEDS_REVISION]: [ProjectStatus.ESTIMATOR_DRAFTING, ProjectStatus.ESTIMATOR_FINAL, ProjectStatus.ADMIN_PACKAGING],
};

// Browser routes use the immutable project reference while legacy links may
// still provide a Mongo ObjectId. Both are accepted during the migration.
const projectKey = z.string().trim().min(1).max(100).refine(
  (value) => !/[/?#]/.test(value),
  'Invalid project identifier format',
);

// Zod validation schemas
export const updateProjectSchema = z.object({
  params: z.object({
    id: projectKey
  }),
  body: z.object({
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}(T.*)?$/, 'Invalid due date (expected YYYY-MM-DD)').optional(),
    assignedEstimatorIds: z.union([z.string(), z.array(z.string())]).transform(val => Array.isArray(val) ? val : [val]).optional(),
    projectName: z.string().trim().min(1).optional(),
    customerName: z.string().trim().min(1).optional(),
    isActive: z.boolean().optional(),
    estimatedCost: z.number().positive().optional(),
    totalSqFt: z.number().positive().optional(),
    status: z.nativeEnum(ProjectStatus).optional(),
    statusCategory: z.enum(['NOT_STARTED', 'PENDING', 'AI_PROCESSING', 'READY_FOR_ESTIMATOR', 'IN_PROGRESS', 'NEEDS_REVISION', 'COMPLETED']).optional(),
    estimatorName: z.string().trim().optional(),
    jobAddress: z.string().trim().optional(),
    zohoLeadId: z.string().trim().optional(),
    leadStatus: z.string().trim().optional(),
    quoteNumber: z.string().trim().optional(),
    description: z.string().nullable().optional()
  }).refine((data: Record<string, any>) => Object.keys(data).length > 0, {
    message: "Update payload cannot be empty"
  })
});

export const getProjectsQuerySchema = z.object({
  query: z.object({
    page: z.string().regex(/^\d+$/).optional().transform(Number),
    limit: z.string().regex(/^\d+$/).optional().transform(Number),
    status: z.nativeEnum(ProjectStatus).optional(),
    statusCategory: z.enum(['NOT_STARTED', 'PENDING', 'AI_PROCESSING', 'READY_FOR_ESTIMATOR', 'IN_PROGRESS', 'NEEDS_REVISION', 'COMPLETED']).optional(),
    projectType: z.nativeEnum(ProjectType).optional(),
    customerName: z.string().optional(),
    assignedEstimatorIds: z.union([z.string(), z.array(z.string())]).transform(val => Array.isArray(val) ? val : [val]).optional(),
    isActive: z.string().transform((val: string) => val === 'true').optional(),
    referenceNumber: z.string().optional(),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}(T.*)?$/, 'Invalid date format (expected YYYY-MM-DD)').optional(),
    search: z.string().trim().max(100).optional(),
    updatedAfter: z.string().datetime().optional(),
    sortBy: z.enum(['createdAt', 'updatedAt', 'dueDate', 'projectName', 'customerName']).optional(),
    sortOrder: z.enum(['asc', 'desc']).optional()
  })
});

export const projectIdSchema = z.object({
  params: z.object({
    id: projectKey
  })
});

export const updateProjectStatusSchema = z.object({
  params: z.object({
    id: projectKey
  }),
  body: z.object({
    status: z.nativeEnum(ProjectStatus, {
      message: 'Invalid project status provided'
    })
  })
});

export const assignEstimatorSchema = z.object({
  params: z.object({
    id: projectKey
  }),
  body: z.object({
    assignedEstimatorIds: z.array(z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid estimator ID format')).min(1, 'At least one estimator must be provided')
  })
});
