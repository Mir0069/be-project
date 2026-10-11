import type { ProjectCreationSource, ProjectType, IProjectAddress } from '@db/models/project.model';
import type { IDomainProject } from '@repositories/interfaces/i-project.repository';

export interface CreateProjectClient {
  customerName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | string[] | null;
  company?: string | null;
  website?: string | null;
}

export interface CreateProjectEstimator {
  id?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface CreateProjectInput {
  projectName: string;
  projectType?: ProjectType;
  projectAddress?: string | null;
  description?: string | null;
  receivedDate?: Date | null;
  leadStatus?: string | null;
  client?: CreateProjectClient | null;
  address?: IProjectAddress | null;
  estimator?: CreateProjectEstimator | null;
  groupId?: string | null;
  isCompetitiveBid?: boolean;
  relatedProjectIds?: string[] | null;
}

export interface ProjectCreationOptions {
  creationSource: ProjectCreationSource;
  zohoLeadId?: string | null;
  // The logged-in user who picked the estimator; recorded for the project's Teams team.
  assignedBy?: string | null;
}

export interface IProjectCreator {
  create(input: CreateProjectInput, options: ProjectCreationOptions): Promise<IDomainProject>;
}

export interface CentralizedProjectView {
  id: string;
  referenceNumber: string;
  projectName: string;
  projectAddress: string | null;
  status: string;
  projectType: string;
  creationSource: string;
  receivedDate: string | null;
  zohoDescription: string | null;
  client: {
    customerName: string | null;
    customerEmail: string | null;
    customerPhone: string | null;
    company: string | null;
    website: string | null;
  };
  address: {
    street: string | null;
    city: string | null;
    state: string | null;
    zipcode: string | null;
    country: string | null;
  };
  estimator: {
    id: string | null;
    name: string | null;
    email: string | null;
    phone: string | null;
  };
  zohoLeadId: string | null;
  createdAt: string;
  updatedAt: string;
}
