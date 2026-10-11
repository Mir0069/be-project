import mongoose from 'mongoose';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import type { Express } from 'express';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { AuthProvider, User, UserRole } from '@db/models/user.model';
import { Project, ProjectCreationSource, ProjectStatus, ProjectType } from '@db/models/project.model';
import {
  TeamsProvisionOutbox,
  type ITeamsProvisionCandidate,
  type TeamsProvisionStatus,
} from '@db/models/teams-provision-outbox.model';
import { TeamsMonitoredChannel } from '@db/models/teams-monitored-channel.model';

let mongod: MongoMemoryServer;
let app: Express;
let projectId: string;

const SALES_EMAIL = 'sm-provision@gfs-test.com';
const SALES_PASSWORD = 'Sm@Test123!';

const CANDIDATE = {
  teamId: 'found-team',
  teamName: 'GFS - 182 Robinson Street',
  channelId: 'found-channel',
  channelName: '182 Robinson St discussion',
  score: 0.95,
  reason: 'team-and-channel',
};

const seedUser = async (email: string, password: string, role: UserRole): Promise<void> => {
  const passwordHash = await bcrypt.hash(password, 10);
  await User.findOneAndUpdate(
    { email },
    {
      email,
      passwordHash,
      authProvider: AuthProvider.LOCAL,
      role,
      firstName: 'Test',
      lastName: 'User',
      isActive: true,
      refreshTokenHash: null,
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );
};

const loginAs = async (email: string, password: string): Promise<string[]> => {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  const cookies = res.headers['set-cookie'];
  if (!cookies) throw new Error('No set-cookie header in response');
  return Array.isArray(cookies) ? cookies : [cookies];
};

const seedJob = (
  status: TeamsProvisionStatus,
  candidates: ITeamsProvisionCandidate[] = [CANDIDATE],
): Promise<unknown> =>
  TeamsProvisionOutbox.create({
    projectId,
    projectName: '182 Robinson St',
    teamName: 'GFS - 182 Robinson St',
    channelName: '182 Robinson St discussion',
    status,
    mode: 'DISCOVER',
    candidates,
  });

const base = (): string => `/api/v1/teams/provisioning/projects/${projectId}`;

beforeAll(async () => {
  process.env['JWT_SECRET'] = process.env['JWT_SECRET'] ?? 'test-access-secret';
  process.env['JWT_REFRESH_SECRET'] = process.env['JWT_REFRESH_SECRET'] ?? 'test-refresh-secret';
  process.env['MAIL_HOST'] = process.env['MAIL_HOST'] ?? 'smtp.test';
  process.env['MAIL_USER'] = process.env['MAIL_USER'] ?? 'test@test.com';
  process.env['MAIL_PASS'] = process.env['MAIL_PASS'] ?? 'test-pass';

  mongod = await MongoMemoryServer.create();
  process.env['MONGODB_URI'] = mongod.getUri();

  const appModule = await import('../../src/app.js');
  app = appModule.app;

  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Project.deleteMany({}),
    TeamsProvisionOutbox.deleteMany({}),
    TeamsMonitoredChannel.deleteMany({}),
  ]);
  await seedUser(SALES_EMAIL, SALES_PASSWORD, UserRole.SALES_MANAGER);

  const project = await Project.create({
    referenceNumber: `GFS-TEST-${Date.now()}`,
    projectName: '182 Robinson St',
    projectType: ProjectType.NEW_ESTIMATE,
    customerName: 'Test Customer',
    status: ProjectStatus.SETUP_PENDING,
    creationSource: ProjectCreationSource.ZOHO_FIRST,
  });
  projectId = project._id.toString();
});

describe('GET /api/v1/teams/provisioning/projects/:projectId', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get(base());
    expect(res.status).toBe(401);
  });

  it('returns NONE (not 404) for a project with no job', async () => {
    const cookies = await loginAs(SALES_EMAIL, SALES_PASSWORD);
    const res = await request(app).get(base()).set('Cookie', cookies);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ state: 'NONE', candidates: [] });
  });

  it('returns the parked candidates awaiting a decision', async () => {
    await seedJob('AWAITING_DECISION');
    const cookies = await loginAs(SALES_EMAIL, SALES_PASSWORD);

    const res = await request(app).get(base()).set('Cookie', cookies);

    expect(res.status).toBe(200);
    expect(res.body.data.state).toBe('AWAITING_DECISION');
    expect(res.body.data.candidates).toHaveLength(1);
    expect(res.body.data.candidates[0]).toMatchObject({
      channelId: 'found-channel',
      linkedProjectIds: [],
    });
  });

  it('reports CONNECTED once a channel is linked', async () => {
    await seedJob('DONE');
    await TeamsMonitoredChannel.create({
      teamId: 'found-team',
      teamName: 'GFS - 182 Robinson Street',
      channelId: 'found-channel',
      channelName: '182 Robinson St discussion',
      projectIds: [projectId],
    });
    const cookies = await loginAs(SALES_EMAIL, SALES_PASSWORD);

    const res = await request(app).get(base()).set('Cookie', cookies);

    expect(res.body.data).toMatchObject({
      state: 'CONNECTED',
      teamName: 'GFS - 182 Robinson Street',
      channelName: '182 Robinson St discussion',
    });
  });
});

describe('POST /api/v1/teams/provisioning/projects/:projectId/connect', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).post(`${base()}/connect`).send(CANDIDATE);
    expect(res.status).toBe(401);
  });

  it('400s on a body missing required fields', async () => {
    await seedJob('AWAITING_DECISION');
    const cookies = await loginAs(SALES_EMAIL, SALES_PASSWORD);

    const res = await request(app).post(`${base()}/connect`).set('Cookie', cookies).send({ teamId: 't1' });

    expect(res.status).toBe(400);
  });

  it('404s when no decision is pending for the project', async () => {
    const cookies = await loginAs(SALES_EMAIL, SALES_PASSWORD);

    const res = await request(app).post(`${base()}/connect`).set('Cookie', cookies).send({
      teamId: 'found-team',
      teamName: 'GFS - 182 Robinson Street',
      channelId: 'found-channel',
      channelName: '182 Robinson St discussion',
    });

    expect(res.status).toBe(404);
  });

  it('409s when the job was already decided', async () => {
    await seedJob('CREATING');
    const cookies = await loginAs(SALES_EMAIL, SALES_PASSWORD);

    const res = await request(app).post(`${base()}/connect`).set('Cookie', cookies).send({
      teamId: 'found-team',
      teamName: 'GFS - 182 Robinson Street',
      channelId: 'found-channel',
      channelName: '182 Robinson St discussion',
    });

    expect(res.status).toBe(409);
  });

  it('connects the candidate, links the project and closes the job', async () => {
    await seedJob('AWAITING_DECISION');
    const cookies = await loginAs(SALES_EMAIL, SALES_PASSWORD);

    const res = await request(app).post(`${base()}/connect`).set('Cookie', cookies).send({
      teamId: 'found-team',
      teamName: 'GFS - 182 Robinson Street',
      channelId: 'found-channel',
      channelName: '182 Robinson St discussion',
    });

    expect(res.status).toBe(200);
    expect(res.body.data.state.state).toBe('CONNECTED');

    const channel = await TeamsMonitoredChannel.findOne({ channelId: 'found-channel' }).lean();
    expect(channel!.projectIds.map((p) => p.toString())).toEqual([projectId]);

    const job = await TeamsProvisionOutbox.findOne({ projectId }).lean();
    expect(job!.status).toBe('DONE');
    expect(job!.decision).toBe('CONNECT');
  });

  it('409s with alreadyLinked when the channel belongs to another project, then accepts force', async () => {
    const otherProject = await Project.create({
      referenceNumber: `GFS-OTHER-${Date.now()}`,
      projectName: '7 Maple Ave',
      projectType: ProjectType.NEW_ESTIMATE,
      customerName: 'Other Customer',
      status: ProjectStatus.SETUP_PENDING,
      creationSource: ProjectCreationSource.ZOHO_FIRST,
    });
    await TeamsMonitoredChannel.create({
      teamId: 'found-team',
      teamName: 'GFS - 182 Robinson Street',
      channelId: 'found-channel',
      channelName: '182 Robinson St discussion',
      projectIds: [otherProject._id],
    });
    await seedJob('AWAITING_DECISION');
    const cookies = await loginAs(SALES_EMAIL, SALES_PASSWORD);

    const payload = {
      teamId: 'found-team',
      teamName: 'GFS - 182 Robinson Street',
      channelId: 'found-channel',
      channelName: '182 Robinson St discussion',
    };

    const conflict = await request(app).post(`${base()}/connect`).set('Cookie', cookies).send(payload);
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.details.alreadyLinked).toBe(true);

    const forced = await request(app)
      .post(`${base()}/connect`)
      .set('Cookie', cookies)
      .send({ ...payload, force: true });
    expect(forced.status).toBe(200);

    const channel = await TeamsMonitoredChannel.findOne({ channelId: 'found-channel' }).lean();
    expect(channel!.projectIds.map((p) => p.toString())).toContain(projectId);
  });
});

describe('POST /api/v1/teams/provisioning/projects/:projectId/create', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).post(`${base()}/create`);
    expect(res.status).toBe(401);
  });

  it('404s when no decision is pending', async () => {
    const cookies = await loginAs(SALES_EMAIL, SALES_PASSWORD);
    const res = await request(app).post(`${base()}/create`).set('Cookie', cookies);
    expect(res.status).toBe(404);
  });

  // Approving a create on a parked job is deliberately NOT exercised over HTTP:
  // env is snapshotted at import, so in a configured environment this route
  // would kick a real Graph drain and create an actual team. The transition
  // (AWAITING_DECISION -> CREATING -> DONE), the double-decide 409 and the
  // unconfigured 503 are covered in teams-provision-decision.service.test.ts
  // and teams-provisioning.integration.test.ts.
});
