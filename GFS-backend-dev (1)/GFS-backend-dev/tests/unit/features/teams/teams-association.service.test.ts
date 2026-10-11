import { TeamsAssociationService } from '@features/teams/teams-association.service';
import type {
  IProjectRepository,
  IDomainProject,
} from '@repositories/interfaces/i-project.repository';
import { ProjectStatus, ProjectType, ProjectCreationSource } from '@db/models/project.model';

const makeProject = (overrides: Partial<IDomainProject>): IDomainProject => ({
  id: 'p1',
  referenceNumber: 'REF-001',
  projectName: 'Project Alpha',
  customerName: 'Acme Corp',
  status: ProjectStatus.SETUP_PENDING,
  projectType: ProjectType.NEW_ESTIMATE,
  creationSource: ProjectCreationSource.ZOHO_FIRST,
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
  estimatedCost: null,
  totalSqFt: null,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

let projectRepo: jest.Mocked<IProjectRepository>;
let service: TeamsAssociationService;

beforeEach(() => {
  projectRepo = {
    findById: jest.fn(),
    findByReferenceNumber: jest.fn(),
    findByZohoLeadId: jest.fn(),
    listActive: jest.fn(),
    create: jest.fn(),
    updateById: jest.fn(),
    deleteById: jest.fn(),
  };
  service = new TeamsAssociationService(projectRepo);
});

describe('TeamsAssociationService — resolveProject', () => {
  it('uses the explicit channel→project mapping first (CHANNEL_MAP)', async () => {
    const result = await service.resolveProject({
      contentText: 'anything',
      channelName: 'General',
      channelProjectId: 'mapped-project',
    });

    expect(result).toEqual({ projectId: 'mapped-project', linkMethod: 'CHANNEL_MAP' });
    expect(projectRepo.listActive).not.toHaveBeenCalled();
  });

  it('auto-matches by project name found in the message text (case-insensitive)', async () => {
    projectRepo.listActive.mockResolvedValue([makeProject({ id: 'p1', projectName: 'Project Alpha' })]);

    const result = await service.resolveProject({
      contentText: 'Drawings updated for project ALPHA today',
      channelName: 'random',
    });

    expect(result).toEqual({ projectId: 'p1', linkMethod: 'AUTO' });
  });

  it('auto-matches by reference number or customer name appearing in the channel name', async () => {
    projectRepo.listActive.mockResolvedValue([
      makeProject({ id: 'p2', projectName: 'Riverside', referenceNumber: 'REF-777', customerName: 'Globex' }),
    ]);

    const result = await service.resolveProject({
      contentText: 'no project keyword here',
      channelName: 'globex-discussion',
    });

    expect(result).toEqual({ projectId: 'p2', linkMethod: 'AUTO' });
  });

  it('returns unlinked when nothing matches', async () => {
    projectRepo.listActive.mockResolvedValue([makeProject({ projectName: 'Project Alpha' })]);

    const result = await service.resolveProject({
      contentText: 'completely unrelated chatter',
      channelName: 'watercooler',
    });

    expect(result).toEqual({ projectId: null, linkMethod: null });
  });
});
