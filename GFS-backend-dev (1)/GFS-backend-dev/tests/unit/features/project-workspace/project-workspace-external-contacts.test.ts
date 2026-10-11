import { ProjectWorkspaceService } from '@features/project-workspace/project-workspace.service';
import { ProjectStatus, ProjectType } from '@features/project-workspace/project-workspace.types';
import type { IDomainProject, IProjectRepository } from '@repositories/interfaces/i-project.repository';
import type { IOutlookEmailRepository } from '@repositories/interfaces/i-outlook-email.repository';
import { UserRole } from '@db/models/user.model';

const project = {
  id: '60d5ecb8b392d7001f8e8e11',
  referenceNumber: 'GFS-2026-1042',
  projectName: 'Contact Test',
  customerName: 'Test Customer',
  status: ProjectStatus.SETUP_PENDING,
  projectType: ProjectType.NEW_ESTIMATE,
  creationSource: 'MAIL_FIRST' as IDomainProject['creationSource'],
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
  lastZohoSyncedAt: null,
  dueDate: undefined,
  estimatedCost: null,
  totalSqFt: null,
  zohoFollowUpTaskId: null,
  zohoFollowUpTaskAt: null,
  isActive: true,
  assignedEstimators: [],
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  updatedAt: new Date('2026-08-01T00:00:00.000Z'),
} as IDomainProject;

describe('ProjectWorkspaceService external contacts', () => {
  const projectRepository = {
    findById: jest.fn(),
    findByReferenceNumber: jest.fn(),
    updateById: jest.fn(),
    deleteById: jest.fn(),
  } as unknown as jest.Mocked<IProjectRepository>;

  const outlookEmailRepository = {
    listParticipantsByProjectId: jest.fn(),
  } as unknown as jest.Mocked<IOutlookEmailRepository>;

  const service = new ProjectWorkspaceService(
    projectRepository,
    {} as never,
    {} as never,
    outlookEmailRepository,
  );

  beforeEach(() => jest.clearAllMocks());

  it('normalizes and deduplicates external participants while excluding internal domains', async () => {
    projectRepository.findById.mockResolvedValue(project);
    outlookEmailRepository.listParticipantsByProjectId.mockResolvedValue([
      {
        fromName: 'Customer Contact',
        fromAddress: ' Customer@Client.com ',
        toRecipients: [
          'gfs2@amberflux.in',
          'architect@designfirm.com',
          'greg@glassflooringsystems.com',
        ],
        ccRecipients: ['CUSTOMER@client.com', 'employee@amberflux.com', 'sales@gfs.com'],
        receivedDateTime: new Date('2026-08-01T10:00:00.000Z'),
      },
      {
        fromName: null,
        fromAddress: 'vendor@supplier.com',
        toRecipients: ['customer@client.com'],
        ccRecipients: [],
        receivedDateTime: new Date('2026-08-02T10:00:00.000Z'),
      },
    ]);

    const contacts = await service.getExternalContacts(project.id, {
      userId: 'sales-manager-id',
      role: UserRole.SALES_MANAGER,
    });

    expect(contacts.map((contact) => contact.email)).toEqual([
      'architect@designfirm.com',
      'customer@client.com',
      'vendor@supplier.com',
    ]);
    expect(contacts.find((contact) => contact.email === 'customer@client.com')).toMatchObject({
      name: 'Customer Contact',
      sources: ['FROM', 'CC', 'TO'],
    });
    expect(outlookEmailRepository.listParticipantsByProjectId).toHaveBeenCalledWith(project.id);
    expect(projectRepository.updateById).toHaveBeenCalledWith(
      project.id,
      { externalContacts: contacts },
    );
  });

  it('allows an assigned estimator to view contacts', async () => {
    projectRepository.findById.mockResolvedValue({
      ...project,
      assignedEstimators: [{ id: 'assigned-estimator', name: 'Estimator', email: 'estimator@example.com' }],
    });
    outlookEmailRepository.listParticipantsByProjectId.mockResolvedValue([]);

    await expect(service.getExternalContacts(project.id, {
      userId: 'assigned-estimator',
      role: UserRole.ESTIMATOR,
    })).resolves.toEqual([]);
  });

  it('rejects an estimator who is not assigned to the project', async () => {
    projectRepository.findById.mockResolvedValue({
      ...project,
      assignedEstimators: [{ id: 'assigned-estimator', name: 'Estimator', email: 'estimator@example.com' }],
    });

    await expect(service.getExternalContacts(project.id, {
      userId: 'different-estimator',
      role: UserRole.ESTIMATOR,
    })).rejects.toMatchObject({ statusCode: 403 });
    expect(outlookEmailRepository.listParticipantsByProjectId).not.toHaveBeenCalled();
  });
});
