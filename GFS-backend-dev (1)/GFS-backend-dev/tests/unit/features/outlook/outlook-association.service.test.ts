import { OutlookAssociationService } from '@features/outlook/outlook-association.service';
import type { IProjectRepository } from '@repositories/interfaces/i-project.repository';

let projectRepo: jest.Mocked<IProjectRepository>;
let service: OutlookAssociationService;

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
  service = new OutlookAssociationService(projectRepo);
});

describe('OutlookAssociationService — resolveProject', () => {
  it('uses the explicit mailbox→project mapping (MAILBOX_MAP)', async () => {
    const result = await service.resolveProject({
      subject: 'anything',
      bodyText: 'anything',
      mailboxProjectId: 'mapped-project',
    });

    expect(result).toEqual({ projectId: 'mapped-project', linkMethod: 'MAILBOX_MAP' });
    // The heuristic matcher was removed — no project lookup should happen.
    expect(projectRepo.listActive).not.toHaveBeenCalled();
  });

  it('returns unlinked (→ goes to AI) when there is no explicit mailbox mapping', async () => {
    const result = await service.resolveProject({
      subject: 'RE: drawings for Project Alpha',
      bodyText: 'this used to auto-match by name/ref/customer, but no longer does',
    });

    expect(result).toEqual({ projectId: null, linkMethod: null });
    expect(projectRepo.listActive).not.toHaveBeenCalled();
  });
});
