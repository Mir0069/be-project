import { ProjectCreationService } from '@features/project-creation/project-creation.service';
import { ProjectCreationSource, ProjectStatus, ProjectType } from '@db/models/project.model';
import type { IDomainProject, IProjectRepository } from '@repositories/interfaces/i-project.repository';

const createdProject: IDomainProject = {
  id: '507f1f77bcf86cd799439011',
  referenceNumber: 'GFS-2026-1002',
  projectName: 'Test project',
  customerName: 'Test customer',
  status: ProjectStatus.SETUP_PENDING,
  projectType: ProjectType.NEW_ESTIMATE,
  creationSource: ProjectCreationSource.MAIL_FIRST,
  identifierHash: null,
  zohoLeadId: 'zoho-1',
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
  lastZohoSyncedAt: null,
  isActive: true,
  estimatedCost: null,
  totalSqFt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('ProjectCreationService reference allocation', () => {
  it('advances past a stale duplicate reference without returning the sequence to it', async () => {
    const projectRepository = {
      findByZohoLeadId: jest.fn().mockResolvedValue(null),
      create: jest
        .fn()
        .mockRejectedValueOnce({
          code: 11000,
          keyPattern: { referenceNumber: 1 },
        })
        .mockResolvedValueOnce(createdProject),
      updateById: jest.fn().mockResolvedValue(createdProject),
      deleteById: jest.fn(),
    } as unknown as IProjectRepository;
    const sequenceRepository = {
      getNextSequenceValue: jest.fn().mockResolvedValueOnce(1001).mockResolvedValueOnce(1002),
      releaseSequenceValue: jest.fn(),
    };
    const fileStorageRepository = {
      getProjectRootPath: jest.fn().mockReturnValue('projects/test'),
      createFolderStructure: jest.fn().mockResolvedValue(undefined),
    };
    const projectParameterRepository = {
      ensureForProject: jest.fn().mockResolvedValue(undefined),
    };
    const service = new ProjectCreationService(
      projectRepository,
      sequenceRepository as any,
      fileStorageRepository as any,
      projectParameterRepository as any,
    );

    await expect(
      service.create(
        { projectName: 'Test project' },
        {
          creationSource: ProjectCreationSource.MAIL_FIRST,
          zohoLeadId: 'zoho-1',
        },
      ),
    ).resolves.toEqual(createdProject);

    expect(projectRepository.create).toHaveBeenNthCalledWith(1, expect.objectContaining({ referenceNumber: 'GFS-2026-1001' }));
    expect(projectRepository.create).toHaveBeenNthCalledWith(2, expect.objectContaining({ referenceNumber: 'GFS-2026-1002' }));
    expect(sequenceRepository.releaseSequenceValue).not.toHaveBeenCalled();
  });
});
