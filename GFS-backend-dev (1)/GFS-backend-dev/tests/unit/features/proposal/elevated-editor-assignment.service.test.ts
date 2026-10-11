import { createEmptySchema } from '../../../../src/features/proposal/schema-registry';
import { ProposalService } from '../../../../src/features/proposal/proposal.service';

jest.mock('../../../../src/features/proposal/queues/stage-trigger.publisher', () => ({
  StageTriggerPublisher: jest.fn().mockImplementation(() => ({
    publish: jest.fn().mockResolvedValue(undefined),
    publishExtraction: jest.fn().mockResolvedValue(undefined),
  })),
}));

const projectId = '507f1f77bcf86cd799439011';
const managerId = '507f1f77bcf86cd799439012';

const buildService = (assignedEstimators: unknown[] = []) => {
  const proposalRepo = {
    getCurrentSchema: jest.fn().mockResolvedValue(createEmptySchema()),
    appendVersion: jest.fn().mockResolvedValue({}),
  };
  const projectRepo = {
    findById: jest.fn().mockResolvedValue({ id: projectId, assignedEstimators }),
    updateById: jest.fn().mockResolvedValue({ id: projectId, assignedEstimators: [managerId] }),
  };
  const service = new ProposalService(
    proposalRepo as any,
    projectRepo as any,
    { recalculate: jest.fn().mockReturnValue([]) } as any,
    {} as any,
  );

  return { service, projectRepo };
};

describe('elevated editor assignment', () => {
  it.each(['SALES_MANAGER', 'HEAD_OF_DIVISION'])('assigns an unassigned project to the first %s editor', async (role) => {
    const { service, projectRepo } = buildService();

    await service.saveFieldEdit(projectId, 'stage_1.project_name', 'Updated project name', managerId, role);

    expect(projectRepo.updateById).toHaveBeenCalledWith(projectId, {
      assignedEstimators: [managerId],
    });
  });

  it('does not replace an existing estimator assignment', async () => {
    const { service, projectRepo } = buildService([{ id: 'existing-estimator' }]);

    await service.saveFieldEdit(projectId, 'stage_1.project_name', 'Updated project name', managerId, 'SALES_MANAGER');

    expect(projectRepo.updateById).not.toHaveBeenCalled();
  });
});
