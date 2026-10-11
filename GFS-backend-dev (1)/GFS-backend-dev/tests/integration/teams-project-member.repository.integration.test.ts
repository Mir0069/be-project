// Runs against a throwaway in-memory MongoDB that is stopped (and its data gone) after the suite.
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { TeamsProjectMember } from '@db/models/teams-project-member.model';
import { MongooseTeamsProjectMemberRepository } from '@repositories/mongoose/teams-project-member.repository';

let mongod: MongoMemoryServer;
const repository = new MongooseTeamsProjectMemberRepository();

const PROJECT_A = new mongoose.Types.ObjectId().toString();
const PROJECT_B = new mongoose.Types.ObjectId().toString();
const ESTIMATOR = new mongoose.Types.ObjectId().toString();
const SALES_MANAGER = new mongoose.Types.ObjectId().toString();

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await TeamsProjectMember.syncIndexes();
});

afterEach(async () => {
  await TeamsProjectMember.deleteMany({});
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe('MongooseTeamsProjectMemberRepository', () => {
  it('inserts only missing rows and keeps existing rows untouched', async () => {
    const first = await repository.ensureMany([
      { projectId: PROJECT_A, userId: ESTIMATOR, teamId: 'team-1', reason: 'ESTIMATOR' },
      { projectId: PROJECT_A, userId: ESTIMATOR, teamId: 'team-1', reason: 'ESTIMATOR' },
      { projectId: PROJECT_A, userId: SALES_MANAGER, teamId: null, reason: 'ASSIGNER' },
    ]);
    const [row] = await repository.listRunnable(10);
    await repository.update(row!.id, { status: 'ADDED', aadUserId: 'aad-1' });

    const second = await repository.ensureMany([
      { projectId: PROJECT_A, userId: ESTIMATOR, teamId: 'team-1', reason: 'HEAD_OF_DIVISION' },
      { projectId: PROJECT_A, userId: ESTIMATOR, teamId: 'team-2', reason: 'ESTIMATOR' },
    ]);

    expect(first).toBe(2);
    expect(second).toBe(1);
    const stored = await TeamsProjectMember.find({}).sort({ teamId: 1 }).lean();
    expect(stored.map((doc) => [doc.teamId, doc.reason, doc.status])).toEqual([
      [null, 'ASSIGNER', 'WAITING_FOR_TEAM'],
      ['team-1', 'ESTIMATOR', 'ADDED'],
      ['team-2', 'ESTIMATOR', 'PENDING'],
    ]);
  });

  it('lists only pending rows that know their team, oldest first', async () => {
    await repository.ensureMany([{ projectId: PROJECT_A, userId: ESTIMATOR, teamId: 'team-1', reason: 'ESTIMATOR' }]);
    await repository.ensureMany([{ projectId: PROJECT_B, userId: ESTIMATOR, teamId: 'team-2', reason: 'ESTIMATOR' }]);
    await repository.ensureMany([{ projectId: PROJECT_B, userId: SALES_MANAGER, teamId: null, reason: 'ASSIGNER' }]);

    const runnable = await repository.listRunnable(10);

    expect(runnable.map((row) => row.teamId)).toEqual(['team-1', 'team-2']);
    expect(await repository.listRunnable(1)).toHaveLength(1);
  });

  it('lists each assigner once per project, whatever team rows they have', async () => {
    await repository.ensureMany([
      { projectId: PROJECT_A, userId: SALES_MANAGER, teamId: null, reason: 'ASSIGNER' },
      { projectId: PROJECT_A, userId: SALES_MANAGER, teamId: 'team-1', reason: 'ASSIGNER' },
      { projectId: PROJECT_B, userId: SALES_MANAGER, teamId: null, reason: 'ASSIGNER' },
      { projectId: PROJECT_A, userId: ESTIMATOR, teamId: 'team-1', reason: 'ESTIMATOR' },
    ]);

    expect(await repository.listAssigners([PROJECT_A])).toEqual([{ projectId: PROJECT_A, userId: SALES_MANAGER }]);
    expect(await repository.listAssigners([])).toEqual([]);
  });

  it('ignores rows with invalid ids instead of throwing', async () => {
    await expect(
      repository.ensureMany([{ projectId: 'not-an-id', userId: ESTIMATOR, teamId: 'team-1', reason: 'ESTIMATOR' }]),
    ).resolves.toBe(0);
    await expect(repository.update('not-an-id', { status: 'ADDED' })).resolves.toBeUndefined();
  });
});
