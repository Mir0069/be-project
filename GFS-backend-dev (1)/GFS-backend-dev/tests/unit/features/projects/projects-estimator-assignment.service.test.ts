import { ProjectsService } from '@features/projects/projects.service';
import type { IDomainProject, IProjectRepository } from '@repositories/interfaces/i-project.repository';
import type { IUserRepository } from '@repositories/interfaces/i-user.repository';
import { UserRole } from '@db/models/user.model';
import { StatusCodes } from 'http-status-codes';

const PROJECT_ID = '60d5ecb8b392d7001f8e8e11';

const project = { id: PROJECT_ID, referenceNumber: 'GFS-1', projectName: 'Tower', assignedEstimators: [] } as unknown as IDomainProject;

const usersById: Record<string, { role: UserRole; firstName: string; lastName: string }> = {
  est: { role: UserRole.ESTIMATOR, firstName: 'Est', lastName: 'One' },
  hod: { role: UserRole.HEAD_OF_DIVISION, firstName: 'Head', lastName: 'Division' },
  sm: { role: UserRole.SALES_MANAGER, firstName: 'Sales', lastName: 'Manager' },
  admin: { role: UserRole.SYSTEM_ADMIN, firstName: 'System', lastName: 'Admin' },
};

const buildService = (current: IDomainProject = project) => {
  const projectRepository = {
    findById: jest.fn().mockResolvedValue(current),
    findByReferenceNumber: jest.fn().mockResolvedValue(null),
    updateById: jest.fn().mockImplementation(async (_id, fields) => ({ ...current, ...fields })),
  } as unknown as jest.Mocked<IProjectRepository>;
  const userRepository = {
    findById: jest.fn().mockImplementation(async (id: string) => (usersById[id] ? { id, ...usersById[id] } : null)),
  } as unknown as jest.Mocked<IUserRepository>;
  const notificationService = { notifyEstimatorAssigned: jest.fn() };
  const teamsMembership = { syncProject: jest.fn().mockResolvedValue(undefined) };

  return {
    service: new ProjectsService(projectRepository, userRepository, notificationService as any, teamsMembership),
    projectRepository,
    notificationService,
    teamsMembership,
  };
};

describe('ProjectsService estimator assignment', () => {
  it('lets a Head of Division be assigned alongside an estimator and notifies both', async () => {
    const { service, projectRepository, notificationService } = buildService();

    await service.updateEstimatorAssignments(PROJECT_ID, { estimatorIds: ['est', 'hod'] });

    expect(projectRepository.updateById).toHaveBeenCalledWith(PROJECT_ID, { assignedEstimators: ['est', 'hod'] });
    expect(notificationService.notifyEstimatorAssigned).toHaveBeenCalledWith(
      expect.objectContaining({
        estimators: [
          { id: 'est', name: 'Est One' },
          { id: 'hod', name: 'Head Division' },
        ],
      }),
    );
  });

  it.each(['sm', 'admin'])('still refuses to assign a non-estimator user (%s)', async (userId) => {
    const { service, projectRepository } = buildService();

    await expect(
      service.updateEstimatorAssignments(PROJECT_ID, { estimatorIds: [userId] }),
    ).rejects.toMatchObject({ statusCode: StatusCodes.BAD_REQUEST });
    expect(projectRepository.updateById).not.toHaveBeenCalled();
  });

  it('asks Teams to add the new estimators and the user who assigned them', async () => {
    const { service, teamsMembership } = buildService();

    await service.updateEstimatorAssignments(PROJECT_ID, { estimatorIds: ['est', 'hod'] }, 'sm');

    expect(teamsMembership.syncProject).toHaveBeenCalledWith({ projectId: PROJECT_ID, assignedBy: 'sm' });
  });

  it('does not touch Teams when nobody new was assigned', async () => {
    const alreadyAssigned = {
      ...project,
      assignedEstimators: [{ id: 'est', name: 'Est One', email: 'est@gfs.test' }],
    } as unknown as IDomainProject;
    const { service, teamsMembership } = buildService(alreadyAssigned);

    await service.updateEstimatorAssignments(PROJECT_ID, { estimatorIds: ['est'] }, 'sm');
    await service.updateEstimatorAssignments(PROJECT_ID, { estimatorIds: [] }, 'sm');

    expect(teamsMembership.syncProject).not.toHaveBeenCalled();
  });
});
