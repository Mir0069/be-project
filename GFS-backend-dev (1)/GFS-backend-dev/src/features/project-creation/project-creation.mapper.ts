import type { IDomainProject } from '@repositories/interfaces/i-project.repository';
import type { CentralizedProjectView } from './project-creation.types';

export const toCentralizedView = (project: IDomainProject): CentralizedProjectView => ({
  id: project.id,
  referenceNumber: project.referenceNumber,
  projectName: project.projectName,
  projectAddress: project.jobAddress,
  status: project.status,
  projectType: project.projectType,
  creationSource: project.creationSource,
  receivedDate: project.receivedDate ? project.receivedDate.toISOString() : null,
  zohoDescription: project.description,
  client: {
    customerName: project.customerName,
    customerEmail: project.customerEmail,
    customerPhone: project.customerPhone,
    company: project.company,
    website: project.customerWebsite,
  },
  address: {
    street: project.address?.street ?? null,
    city: project.address?.city ?? null,
    state: project.address?.state ?? null,
    zipcode: project.address?.zipcode ?? null,
    country: project.address?.country ?? null,
  },
  estimator: {
    id: project.assignedEstimators?.[0]?.id ?? null,
    name: project.assignedEstimators?.[0]?.name ?? null,
    email: project.assignedEstimators?.[0]?.email ?? null,
    phone: null,
  },
  zohoLeadId: project.zohoLeadId,
  createdAt: project.createdAt.toISOString(),
  updatedAt: project.updatedAt.toISOString(),
});
