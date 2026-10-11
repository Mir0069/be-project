import { ProjectWorkspaceService } from '@features/project-workspace/project-workspace.service';
import type { IDomainProject, IProjectRepository } from '@repositories/interfaces/i-project.repository';
import type { IUserRepository } from '@repositories/interfaces/i-user.repository';

const PROJECT_ID = '60d5ecb8b392d7001f8e8e11';

const makeProject = (assignedEstimators: IDomainProject['assignedEstimators'] = []): IDomainProject =>
  ({
    id: PROJECT_ID,
    referenceNumber: 'GFS-2026-0001',
    projectName: 'Tower',
    customerName: 'Customer',
    status: 'SETUP_PENDING',
    assignedEstimators,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  }) as unknown as IDomainProject;

const estimator = (id: string) => ({ id, firstName: id, lastName: 'User', email: `${id}@gfs.test`, isActive: true });

const buildService = (current: IDomainProject) => {
  const projectRepository = {
    findById: jest.fn().mockResolvedValue(current),
    findByReferenceNumber: jest.fn().mockResolvedValue(null),
    updateById: jest.fn().mockImplementation(async (_id: string, fields: { assignedEstimators: string[] }) =>
      makeProject(fields.assignedEstimators.map((id) => ({ id, name: id, email: `${id}@gfs.test` })))),
  } as unknown as jest.Mocked<IProjectRepository>;
  const userRepository = {
    findById: jest.fn().mockImplementation(async (id: string) => estimator(id)),
  } as unknown as jest.Mocked<IUserRepository>;
  const teamsMembership = { syncProject: jest.fn().mockResolvedValue(undefined) };

  const service = new ProjectWorkspaceService(
    projectRepository,
    { validateTransitionRequirements: jest.fn(), executeTransitionActions: jest.fn() } as any,
    userRepository,
    {} as any,
    { notifyEstimatorAssigned: jest.fn() } as any,
    teamsMembership,
  );
  return { service, teamsMembership };
};

describe('ProjectWorkspaceService.assignEstimator — Teams membership', () => {
  it('asks Teams to add newly assigned estimators and the assigning user', async () => {
    const { service, teamsMembership } = buildService(makeProject());

    await service.assignEstimator(PROJECT_ID, ['est-1', 'est-2'], 'sm-1');

    expect(teamsMembership.syncProject).toHaveBeenCalledTimes(1);
    expect(teamsMembership.syncProject).toHaveBeenCalledWith({ projectId: PROJECT_ID, assignedBy: 'sm-1' });
  });

  it('does not touch Teams when the estimators were already assigned', async () => {
    const { service, teamsMembership } = buildService(
      makeProject([{ id: 'est-1', name: 'est-1', email: 'est-1@gfs.test' }]),
    );

    await service.assignEstimator(PROJECT_ID, ['est-1'], 'sm-1');

    expect(teamsMembership.syncProject).not.toHaveBeenCalled();
  });

  it('still works without a Teams membership service', async () => {
    const { service } = buildService(makeProject());
    const withoutTeams = new ProjectWorkspaceService(
      (service as any).projectRepository,
      (service as any).workflowService,
      (service as any).userRepository,
      {} as any,
    );

    await expect(withoutTeams.assignEstimator(PROJECT_ID, ['est-1'])).resolves.toMatchObject({ id: PROJECT_ID });
  });
});
