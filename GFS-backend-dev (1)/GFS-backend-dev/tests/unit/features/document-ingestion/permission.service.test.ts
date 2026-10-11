import { RoleBasedPermissionService } from '@features/document-ingestion/permission.service';
import type { DocumentRecord } from '@features/document-ingestion/document-ingestion.types';
import { Project } from '@db/models/project.model';

jest.mock('@db/models/project.model', () => ({
  Project: { findById: jest.fn() },
}));

const findByIdMock = Project.findById as unknown as jest.Mock;
const PROJECT_ID = '60d5ecb8b392d7001f8e8e11';
const document = { id: 'doc-1', projectId: PROJECT_ID } as DocumentRecord;

const setProject = (project: unknown) =>
  findByIdMock.mockReturnValue({
    select: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(project),
  });

describe('RoleBasedPermissionService', () => {
  const service = new RoleBasedPermissionService();

  beforeEach(() => jest.clearAllMocks());

  it('treats a head of division as elevated for every document action', async () => {
    const ctx = { userId: 'hod-1', roles: ['HEAD_OF_DIVISION'] };

    await expect(service.assertCanUpload(ctx, PROJECT_ID)).resolves.toBeUndefined();
    await expect(service.assertCanUpdate(ctx, document)).resolves.toBeUndefined();
    await expect(service.assertCanDelete(ctx, document)).resolves.toBeUndefined();
    expect(findByIdMock).not.toHaveBeenCalled();
  });

  it('still blocks an estimator who is not assigned to the project', async () => {
    setProject({ assignedEstimators: ['someone-else'] });

    await expect(
      service.assertCanUpload({ userId: 'est-1', roles: ['ESTIMATOR'] }, PROJECT_ID),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('still lets a sales manager upload without an assignment', async () => {
    await expect(
      service.assertCanUpload({ userId: 'sm-1', roles: ['SALES_MANAGER'] }, PROJECT_ID),
    ).resolves.toBeUndefined();
  });
});
