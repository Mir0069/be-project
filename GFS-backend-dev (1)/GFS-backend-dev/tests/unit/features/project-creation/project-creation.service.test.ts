import { ProjectCreationService } from '@features/project-creation/project-creation.service';
import { ProjectStatus, ProjectType, ProjectCreationSource } from '@db/models/project.model';

const mockProjectRepo = {
  create: jest.fn(),
  findByZohoLeadId: jest.fn(),
  updateById: jest.fn(),
  // Compensating rollback of a create whose dependent write failed.
  deleteById: jest.fn(),
};
const mockSeqRepo = { getNextSequenceValue: jest.fn(), releaseSequenceValue: jest.fn() };
const mockStorage = {
  getProjectRootPath: jest.fn(),
  createFolderStructure: jest.fn(),
  uploadFile: jest.fn(),
  getDownloadUrl: jest.fn(),
  deleteFile: jest.fn(),
};
const mockParamRepo = {
  create: jest.fn(),
  // Idempotent seed: the project and its parameter row are one unit of work.
  ensureForProject: jest.fn(),
  findByProjectId: jest.fn(),
  updateByProjectId: jest.fn(),
};

let service: ProjectCreationService;
const mockTeamsMembership = { syncProject: jest.fn() };
const mockMailerService = {
  sendMail: jest.fn(),
  sendInviteLink: jest.fn(),
  sendPasswordResetLink: jest.fn(),
  sendEstimatorAssignedNotification: jest.fn(),
};
const mockNotificationService = {
  notifyEstimatorAssigned: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  mockSeqRepo.getNextSequenceValue.mockResolvedValue(1001);
  mockStorage.getProjectRootPath.mockReturnValue('projects/p1');
  mockStorage.createFolderStructure.mockResolvedValue(undefined);
  mockParamRepo.create.mockResolvedValue({});
  mockParamRepo.ensureForProject.mockResolvedValue({});
  mockProjectRepo.deleteById.mockResolvedValue(true);
  mockSeqRepo.releaseSequenceValue.mockResolvedValue(true);
  mockProjectRepo.updateById.mockImplementation((_id: string, fields: Record<string, unknown>) =>
    Promise.resolve({ id: 'p1', ...fields }),
  );
  service = new ProjectCreationService(
    mockProjectRepo as any,
    mockSeqRepo as any,
    mockStorage as any,
    mockParamRepo as any,
    mockTeamsMembership,
    mockMailerService as any,
    mockNotificationService as any,
  );
});

describe('ProjectCreationService.create — Teams membership', () => {
  const ESTIMATOR_ID = '60d5ecb8b392d7001f8e8e01';

  it('records the user who picked the estimator for the project team', async () => {
    mockProjectRepo.findByZohoLeadId.mockResolvedValue(null);
    mockProjectRepo.create.mockResolvedValue({ id: 'p1' });

    const created = await service.create(
      { projectName: 'Glazing', estimator: { id: ESTIMATOR_ID } } as any,
      { creationSource: ProjectCreationSource.MANUAL, assignedBy: 'sm-1' },
    );

    expect(mockTeamsMembership.syncProject).toHaveBeenCalledWith({ projectId: created.id, assignedBy: 'sm-1' });
  });

  it('does not touch Teams without an estimator or without a logged-in assigner', async () => {
    mockProjectRepo.findByZohoLeadId.mockResolvedValue(null);
    mockProjectRepo.create.mockResolvedValue({ id: 'p1' });

    await service.create({ projectName: 'No estimator' }, { creationSource: ProjectCreationSource.MANUAL, assignedBy: 'sm-1' });
    await service.create(
      { projectName: 'System created', estimator: { id: ESTIMATOR_ID } } as any,
      { creationSource: ProjectCreationSource.ZOHO_FIRST },
    );

    expect(mockTeamsMembership.syncProject).not.toHaveBeenCalled();
  });
});

describe('ProjectCreationService.create', () => {
  it('generates a reference number and persists the requested source plus fields', async () => {
    mockProjectRepo.findByZohoLeadId.mockResolvedValue(null);
    const year = new Date().getFullYear();
    mockProjectRepo.create.mockResolvedValue({ id: 'p1', referenceNumber: `GFS-${year}-1001` });

    const res = await service.create(
      { projectName: 'Glazing', client: { company: 'Acme' } },
      { creationSource: ProjectCreationSource.MANUAL },
    );

    expect(mockProjectRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        referenceNumber: `GFS-${year}-1001`,
        projectName: 'Glazing',
        customerName: 'Acme',
        projectType: ProjectType.NEW_ESTIMATE,
        status: ProjectStatus.SETUP_PENDING,
        creationSource: ProjectCreationSource.MANUAL,
        company: 'Acme',
      }),
    );
    expect(mockParamRepo.ensureForProject).toHaveBeenCalledWith('p1');
    expect(res.id).toBe('p1');
  });

  it('falls back to projectName for customerName when no client name/company given', async () => {
    mockProjectRepo.findByZohoLeadId.mockResolvedValue(null);
    mockProjectRepo.create.mockResolvedValue({ id: 'p1' });

    await service.create({ projectName: 'Standalone' }, { creationSource: ProjectCreationSource.MANUAL });

    expect(mockProjectRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ customerName: 'Standalone' }),
    );
  });

  it('throws when projectName is blank', async () => {
    await expect(
      service.create({ projectName: '   ' }, { creationSource: ProjectCreationSource.MANUAL }),
    ).rejects.toThrow('projectName is required');
    expect(mockProjectRepo.create).not.toHaveBeenCalled();
  });

  it('is idempotent — returns the existing project when the zohoLeadId already maps to one', async () => {
    mockProjectRepo.findByZohoLeadId.mockResolvedValue({ id: 'existing' });

    const res = await service.create(
      { projectName: 'X' },
      { creationSource: ProjectCreationSource.ZOHO_FIRST, zohoLeadId: 'lead-1' },
    );

    expect(res.id).toBe('existing');
    expect(mockProjectRepo.create).not.toHaveBeenCalled();
  });

  it('recovers from a duplicate-key race by returning the winning project', async () => {
    mockProjectRepo.findByZohoLeadId
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'winner' });
    mockProjectRepo.create.mockRejectedValue({ code: 11000 });

    const res = await service.create(
      { projectName: 'X' },
      { creationSource: ProjectCreationSource.ZOHO_FIRST, zohoLeadId: 'lead-1' },
    );

    expect(res.id).toBe('winner');
  });
});

describe('ProjectCreationService.create — Estimator assignment email notification', () => {
  const ESTIMATOR_ID = '60d5ecb8b392d7001f8e8e01';

  it('sends email notification and emits in-app notification when estimator is assigned', async () => {
    mockProjectRepo.findByZohoLeadId.mockResolvedValue(null);
    mockProjectRepo.create.mockResolvedValue({
      id: 'p100',
      referenceNumber: 'GFS-2026-1001',
      projectName: 'Office Tower Glazing',
      customerName: 'Skyline Inc',
      projectType: ProjectType.NEW_ESTIMATE,
      assignedEstimators: [
        {
          id: ESTIMATOR_ID,
          name: 'Jane Estimator',
          email: 'jane@gfs.com',
          status: 'Active',
        },
      ],
    });

    const res = await service.create(
      {
        projectName: 'Office Tower Glazing',
        client: { customerName: 'Skyline Inc' },
        estimator: { id: ESTIMATOR_ID, name: 'Jane Estimator', email: 'jane@gfs.com' },
      } as any,
      { creationSource: ProjectCreationSource.MANUAL, assignedBy: 'sm-1' },
    );

    expect(res.id).toBe('p100');

    // Mailer should be invoked with project details and recipient email
    expect(mockMailerService.sendEstimatorAssignedNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'jane@gfs.com',
        recipientName: 'Jane Estimator',
        referenceNumber: 'GFS-2026-1001',
        projectName: 'Office Tower Glazing',
        customerName: 'Skyline Inc',
        projectType: ProjectType.NEW_ESTIMATE,
      }),
    );

    // In-app notification should be triggered
    expect(mockNotificationService.notifyEstimatorAssigned).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'p100',
        referenceNumber: 'GFS-2026-1001',
        projectName: 'Office Tower Glazing',
        estimators: [expect.objectContaining({ id: ESTIMATOR_ID, name: 'Jane Estimator' })],
      }),
    );
  });

  it('does not send email notification when no estimator is assigned', async () => {
    mockProjectRepo.findByZohoLeadId.mockResolvedValue(null);
    mockProjectRepo.create.mockResolvedValue({
      id: 'p101',
      referenceNumber: 'GFS-2026-1002',
      projectName: 'Warehouse Door',
      assignedEstimators: [],
    });

    await service.create(
      { projectName: 'Warehouse Door' },
      { creationSource: ProjectCreationSource.MANUAL },
    );

    expect(mockMailerService.sendEstimatorAssignedNotification).not.toHaveBeenCalled();
    expect(mockNotificationService.notifyEstimatorAssigned).not.toHaveBeenCalled();
  });

  it('does not fail project creation if mailer throws an error', async () => {
    mockProjectRepo.findByZohoLeadId.mockResolvedValue(null);
    mockProjectRepo.create.mockResolvedValue({
      id: 'p102',
      referenceNumber: 'GFS-2026-1003',
      projectName: 'Retail Facade',
      assignedEstimators: [
        {
          id: ESTIMATOR_ID,
          name: 'Jane Estimator',
          email: 'jane@gfs.com',
          status: 'Active',
        },
      ],
    });
    mockMailerService.sendEstimatorAssignedNotification.mockRejectedValue(new Error('Graph API 500 error'));

    const res = await service.create(
      {
        projectName: 'Retail Facade',
        estimator: { id: ESTIMATOR_ID, email: 'jane@gfs.com' },
      } as any,
      { creationSource: ProjectCreationSource.MANUAL },
    );

    expect(res.id).toBe('p102');
    expect(mockMailerService.sendEstimatorAssignedNotification).toHaveBeenCalled();
  });
});

