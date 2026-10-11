import { ProjectStatus } from '@db/models/project.model';
import { StatusReportService } from '@features/status-report/status-report.service';
import type { IDomainProject, IProjectRepository } from '@repositories/interfaces/i-project.repository';

const makeProject = (status: ProjectStatus): IDomainProject => ({
  id: 'project-1',
  referenceNumber: 'GFS-2026-1001',
  projectName: 'Test Project',
  customerName: 'Test Customer',
  status,
  projectType: 'NEW_ESTIMATE' as IDomainProject['projectType'],
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
  estimatedCost: 2500,
  totalSqFt: null,
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
  updatedAt: new Date('2026-09-01T00:00:00.000Z'),
});

describe('StatusReportService', () => {
  it('reports workflow statuses using their Kanban column', async () => {
    const repository = {
      listActive: jest.fn().mockResolvedValue([makeProject(ProjectStatus.ADMIN_PACKAGING)]),
    } as unknown as jest.Mocked<IProjectRepository>;
    const service = new StatusReportService(repository);

    const result = await service.build({ period: 'ytd', year: 2026 });

    expect(result.pipeline.byStatus).toEqual({
      'Resubmit Proposal': { count: 1, value: 2500 },
    });
  });

  it('groups a revision request in the resubmission Kanban column', async () => {
    const repository = {
      listActive: jest.fn().mockResolvedValue([makeProject(ProjectStatus.NEEDS_REVISION)]),
    } as unknown as jest.Mocked<IProjectRepository>;
    const service = new StatusReportService(repository);

    const result = await service.build({ period: 'ytd', year: 2026 });

    expect(result.pipeline.byStatus).toEqual({
      'Resubmit Proposal': { count: 1, value: 2500 },
    });
  });
});
