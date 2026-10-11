// =============================================================================
// PROJECT ACCESS PARAM GUARD
// =============================================================================
// The proposal router exposes 20+ project-scoped endpoints behind a single
// router.param() guard. Reads used to be open to any authenticated user, so an
// estimator could pull the stages, timeline and pricing of a project assigned
// to somebody else just by changing the id in the URL.

import { requireProjectAccess } from '@shared/middleware/project-access.middleware';
import { Project } from '@db/models/project.model';
import { UserRole } from '@db/models/user.model';
import { StatusCodes } from 'http-status-codes';

jest.mock('@db/models/project.model', () => ({
  Project: { findById: jest.fn() },
}));

const findByIdMock = Project.findById as unknown as jest.Mock;

const OWNER_ID = '60d5ecb8b392d7001f8e8e01';
const OTHER_ID = '60d5ecb8b392d7001f8e8e02';
const PROJECT_ID = '60d5ecb8b392d7001f8e8e11';

const setProject = (project: any) =>
  findByIdMock.mockReturnValue({
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(project),
  });

const setLookupFailure = (err: Error) =>
  findByIdMock.mockReturnValue({
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn().mockRejectedValue(err),
  });

const run = async (user: any) => {
  const next = jest.fn();
  await requireProjectAccess({ user } as any, {} as any, next, PROJECT_ID);
  return next;
};

const expectAllowed = (next: jest.Mock) => expect(next).toHaveBeenCalledWith();

const expectStatus = (next: jest.Mock, status: number) => {
  expect(next).toHaveBeenCalledTimes(1);
  expect(next.mock.calls[0]?.[0]).toMatchObject({ statusCode: status });
};

describe('requireProjectAccess', () => {
  beforeEach(() => jest.clearAllMocks());

  it('lets the assigned estimator through', async () => {
    setProject({ assignedEstimators: [OWNER_ID] });
    expectAllowed(await run({ userId: OWNER_ID, role: UserRole.ESTIMATOR }));
  });

  it('matches a populated assignment object, not just a bare id', async () => {
    setProject({ assignedEstimators: [{ _id: OWNER_ID, email: 'est@gfs.test' }] });
    expectAllowed(await run({ userId: OWNER_ID, role: UserRole.ESTIMATOR }));
  });

  it('blocks an estimator assigned to a different project', async () => {
    setProject({ assignedEstimators: [OTHER_ID] });
    expectStatus(await run({ userId: OWNER_ID, role: UserRole.ESTIMATOR }), StatusCodes.FORBIDDEN);
  });

  it('blocks an estimator on an unassigned project', async () => {
    setProject({ assignedEstimators: [] });
    expectStatus(await run({ userId: OWNER_ID, role: UserRole.ESTIMATOR }), StatusCodes.FORBIDDEN);
  });

  it('blocks an estimator when the project has no assignment field at all', async () => {
    setProject({});
    expectStatus(await run({ userId: OWNER_ID, role: UserRole.ESTIMATOR }), StatusCodes.FORBIDDEN);
  });

  it.each([
    ['sales manager', UserRole.SALES_MANAGER],
    ['system admin', UserRole.SYSTEM_ADMIN],
    ['super admin', UserRole.SUPER_ADMIN],
    ['head of division', UserRole.HEAD_OF_DIVISION],
  ])('lets a %s through without a lookup', async (_label, role) => {
    expectAllowed(await run({ userId: 'someone', role }));
    expect(findByIdMock).not.toHaveBeenCalled();
  });

  it('passes through unauthenticated system AI callbacks untouched', async () => {
    expectAllowed(await run(undefined));
    expect(findByIdMock).not.toHaveBeenCalled();
  });

  it('reports a missing project as 404', async () => {
    setProject(null);
    expectStatus(await run({ userId: OWNER_ID, role: UserRole.ESTIMATOR }), StatusCodes.NOT_FOUND);
  });

  it('turns a malformed id into 404 rather than a 500', async () => {
    setLookupFailure(new Error('Cast to ObjectId failed'));
    expectStatus(await run({ userId: OWNER_ID, role: UserRole.ESTIMATOR }), StatusCodes.NOT_FOUND);
  });
});
