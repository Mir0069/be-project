import { ProjectWorkspaceService } from '@features/project-workspace/project-workspace.service';
import { ProjectStatus, ProjectType } from '@features/project-workspace/project-workspace.types';
import type { IDomainProject, IProjectRepository } from '@repositories/interfaces/i-project.repository';
import { UserRole } from '@db/models/user.model';

// Reference-number lookup is what these tests cover, so view as a role that is
// allowed to open any project.
const MANAGER_VIEWER = { userId: 'sales-manager-1', role: UserRole.SALES_MANAGER };

const project = {
  id: '60d5ecb8b392d7001f8e8e11',
  referenceNumber: 'GFS-2026-1042',
  projectName: 'Public Route Test',
  customerName: 'Test Customer',
  status: ProjectStatus.SETUP_PENDING,
  projectType: ProjectType.NEW_ESTIMATE,
  creationSource: 'MANUAL' as IDomainProject['creationSource'],
  identifierHash: null,
  zohoLeadId: null,
  jobAddress: null,
  quoteNumber: null,
  leadStatus: null,
  blobStorageURL: null,
  dropboxFolderPath: null,
  customerEmail: null,
  customerPhone: null,
  company: null,
  customerWebsite: null,
  description: null,
  receivedDate: null,
  address: null,
  assignedEstimators: [],
  lastZohoSyncedAt: null,
  dueDate: undefined,
  isActive: true,
  estimatedCost: null,
  totalSqFt: null,
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  updatedAt: new Date('2026-08-01T00:00:00.000Z'),
} as IDomainProject;

describe('ProjectWorkspaceService public project keys', () => {
  const projectRepository = {
    findById: jest.fn(),
    findByReferenceNumber: jest.fn(),
  } as unknown as jest.Mocked<IProjectRepository>;
  const service = new ProjectWorkspaceService(
    projectRepository,
    {} as never,
    {} as never,
    {} as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it('resolves a browser-facing reference number', async () => {
    projectRepository.findByReferenceNumber.mockResolvedValue(project);

    const result = await service.getProjectById(project.referenceNumber, MANAGER_VIEWER);

    expect(result.id).toBe(project.id);
    expect(projectRepository.findByReferenceNumber).toHaveBeenCalledWith(project.referenceNumber);
    expect(projectRepository.findById).not.toHaveBeenCalled();
  });

  it('keeps existing Mongo ObjectId API links working', async () => {
    projectRepository.findById.mockResolvedValue(project);

    const result = await service.getProjectById(project.id, MANAGER_VIEWER);

    expect(result.referenceNumber).toBe(project.referenceNumber);
    expect(projectRepository.findById).toHaveBeenCalledWith(project.id);
    expect(projectRepository.findByReferenceNumber).not.toHaveBeenCalled();
  });
});
