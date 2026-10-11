import { ProjectsService } from '@features/projects/projects.service';
import type { IDomainProject, IProjectRepository } from '@repositories/interfaces/i-project.repository';
import { UserRole } from '@db/models/user.model';

// Grouping is what these cover, so view as a role allowed to open any project.
const MANAGER_VIEWER = { userId: 'sales-manager-1', role: UserRole.SALES_MANAGER };

const project = (id: string, groupId = 'bid-group'): IDomainProject => ({
  id,
  groupId,
  relatedProjectIds: [],
} as unknown as IDomainProject);

describe('ProjectsService related competitive bids', () => {
  it('finds projects by group when explicit related ids are not populated', async () => {
    const repository = {
      findById: jest.fn().mockResolvedValue(project('primary')),
      findByGroupId: jest.fn().mockResolvedValue([
        project('primary'),
        project('bidder-two'),
        project('bidder-three'),
      ]),
    } as unknown as jest.Mocked<IProjectRepository>;
    const service = new ProjectsService(repository, {} as any);

    const result = await service.getRelatedProjects('primary', MANAGER_VIEWER);

    expect(result.map((item) => item.id)).toEqual(['bidder-two', 'bidder-three']);
    expect(repository.findByGroupId).toHaveBeenCalledWith('bid-group');
  });

  it('uses explicit related ids when available', async () => {
    const repository = {
      findById: jest.fn()
        .mockResolvedValueOnce({ ...project('primary'), relatedProjectIds: ['bidder-two'] })
        .mockResolvedValueOnce(project('bidder-two')),
      findByGroupId: jest.fn(),
    } as unknown as jest.Mocked<IProjectRepository>;
    const service = new ProjectsService(repository, {} as any);

    const result = await service.getRelatedProjects('primary', MANAGER_VIEWER);

    expect(result.map((item) => item.id)).toEqual(['bidder-two']);
    expect(repository.findByGroupId).not.toHaveBeenCalled();
  });
});
