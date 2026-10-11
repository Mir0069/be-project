import mongoose from 'mongoose';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import type { Express } from 'express';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { AuthProvider, User, UserRole } from '@db/models/user.model';
import { Project, ProjectStatus, ProjectType } from '@db/models/project.model';
import { CallRecord, AiExtractionStatus } from '@db/models/call-record.model';
import { expectNoMongooseInternals } from '../support/expect-no-mongoose-internals';

let app: Express;
let mongod: MongoMemoryServer;

// ─── Constants ────────────────────────────────────────────────────────────────

const SALES_EMAIL = 'sales@gfs-test.com';
const SALES_PASSWORD = 'Sales@Test123!';
const ESTIMATOR_EMAIL = 'estimator@gfs-test.com';
const ESTIMATOR_PASSWORD = 'Estimator@Test123!';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const seedUser = async (overrides: {
  email: string;
  password: string;
  role: UserRole;
}): Promise<string> => {
  const passwordHash = await bcrypt.hash(overrides.password, 10);
  const user = await User.findOneAndUpdate(
    { email: overrides.email },
    {
      email: overrides.email,
      passwordHash,
      authProvider: AuthProvider.LOCAL,
      role: overrides.role,
      firstName: 'Test',
      lastName: 'User',
      isActive: true,
      refreshTokenHash: null,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return user!._id.toString();
};

const seedProject = async (overrides?: Partial<{
  referenceNumber: string;
  projectName: string;
  customerName: string;
}>): Promise<string> => {
  const project = await Project.create({
    referenceNumber: overrides?.referenceNumber ?? `GFS-${Date.now()}`,
    projectName: overrides?.projectName ?? 'Test Glass Project',
    customerName: overrides?.customerName ?? 'Acme Corp',
    status: ProjectStatus.READY_FOR_ESTIMATOR,
    projectType: ProjectType.NEW_ESTIMATE,
    isActive: true,
  });
  return project._id.toString();
};

const loginAs = async (email: string, password: string): Promise<string[]> => {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  const cookies = res.headers['set-cookie'];
  if (!cookies) throw new Error('No set-cookie header');
  return Array.isArray(cookies) ? cookies : [cookies];
};

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();

  process.env['JWT_SECRET'] = process.env['JWT_SECRET'] ?? 'test-access-secret';
  process.env['JWT_REFRESH_SECRET'] = process.env['JWT_REFRESH_SECRET'] ?? 'test-refresh-secret';
  process.env['MONGODB_URI'] = uri;

  const appModule = await import('../../src/app.js');
  app = appModule.app;

  await mongoose.connect(uri);
});

beforeEach(async () => {
  if (mongoose.connection.readyState === 1) {
    await seedUser({ email: SALES_EMAIL, password: SALES_PASSWORD, role: UserRole.SALES_MANAGER });
    await seedUser({ email: ESTIMATOR_EMAIL, password: ESTIMATOR_PASSWORD, role: UserRole.ESTIMATOR });
  }
});

afterEach(async () => {
  if (mongoose.connection.readyState === 1) {
    await CallRecord.deleteMany({});
    await Project.deleteMany({});
    // Delete all users — contrib users are re-created per test via seedUser, so wiping the
    // entire collection is safe. The two primary users are re-seeded in beforeEach.
    await User.deleteMany({});
  }
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

// ─── POST / — Create call record ──────────────────────────────────────────────

describe('POST /api/v1/projects/:projectId/call-records', () => {
  it('creates a call record with summaryText (201)', async () => {
    const projectId = await seedProject();
    const cookies = await loginAs(SALES_EMAIL, SALES_PASSWORD);

    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/call-records`)
      .set('Cookie', cookies)
      .send({
        callDate: '2026-05-01',
        customerName: 'Acme Corp',
        summaryText: 'Customer wants a 10m x 6m glass enclosure with Series 2000.',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.callRecord.customerName).toBe('Acme Corp');
    expect(res.body.data.callRecord.summaryText).toContain('Series 2000');
    expect(res.body.data.callRecord.aiExtractionStatus).toBe(AiExtractionStatus.NOT_REQUESTED);
    expectNoMongooseInternals(res.body);
  });

  it('creates a call record with transcriptFileUrl (201)', async () => {
    const projectId = await seedProject();
    const cookies = await loginAs(ESTIMATOR_EMAIL, ESTIMATOR_PASSWORD);

    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/call-records`)
      .set('Cookie', cookies)
      .send({
        callDate: '2026-05-10',
        customerName: 'BuildRight Pty Ltd',
        transcriptFileUrl: 'https://storage.example.com/transcripts/call-001.txt',
        transcriptFileName: 'call-001.txt',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.callRecord.transcriptFileUrl).toContain('call-001.txt');
  });

  it('returns 400 when neither summaryText nor transcriptFileUrl is provided', async () => {
    const projectId = await seedProject();
    const cookies = await loginAs(SALES_EMAIL, SALES_PASSWORD);

    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/call-records`)
      .set('Cookie', cookies)
      .send({
        callDate: '2026-05-01',
        customerName: 'Acme Corp',
      });

    expect(res.status).toBe(400);
  });

  it('returns 400 when callDate is missing', async () => {
    const projectId = await seedProject();
    const cookies = await loginAs(SALES_EMAIL, SALES_PASSWORD);

    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/call-records`)
      .set('Cookie', cookies)
      .send({ customerName: 'Acme Corp', summaryText: 'Summary' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when customerName is missing', async () => {
    const projectId = await seedProject();
    const cookies = await loginAs(SALES_EMAIL, SALES_PASSWORD);

    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/call-records`)
      .set('Cookie', cookies)
      .send({ callDate: '2026-05-01', summaryText: 'Summary text' });

    expect(res.status).toBe(400);
  });

  it('returns 404 when project does not exist', async () => {
    const cookies = await loginAs(SALES_EMAIL, SALES_PASSWORD);

    const res = await request(app)
      .post(`/api/v1/projects/${new mongoose.Types.ObjectId()}/call-records`)
      .set('Cookie', cookies)
      .send({ callDate: '2026-05-01', customerName: 'Acme', summaryText: 'Test' });

    expect(res.status).toBe(404);
  });

  it('returns 401 when not authenticated', async () => {
    const projectId = await seedProject();

    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/call-records`)
      .send({ callDate: '2026-05-01', customerName: 'Acme', summaryText: 'Test' });

    expect(res.status).toBe(401);
  });
});

// ─── GET / — List call records ────────────────────────────────────────────────

describe('GET /api/v1/projects/:projectId/call-records', () => {
  it('returns paginated call records with pagination metadata (200)', async () => {
    const projectId = await seedProject();
    const userId = await seedUser({ email: 'contrib@gfs-test.com', password: 'Pass@1234', role: UserRole.ESTIMATOR });

    await CallRecord.create([
      { projectId, callDate: new Date(), customerName: 'Acme', summaryText: 'First call', contributedBy: userId, isActive: true },
      { projectId, callDate: new Date(), customerName: 'Acme', summaryText: 'Second call', contributedBy: userId, isActive: true },
    ]);

    const cookies = await loginAs(ESTIMATOR_EMAIL, ESTIMATOR_PASSWORD);
    const res = await request(app)
      .get(`/api/v1/projects/${projectId}/call-records`)
      .set('Cookie', cookies);

    expect(res.status).toBe(200);
    expect(res.body.data.callRecords).toHaveLength(2);
    expect(res.body.data.pagination).toMatchObject({
      total: 2,
      page: 1,
      limit: 12,
      totalPages: 1,
    });
    expectNoMongooseInternals(res.body);
  });

  it('respects explicit page and limit query params', async () => {
    const projectId = await seedProject();
    const userId = await seedUser({ email: 'contrib-pg@gfs-test.com', password: 'Pass@1234', role: UserRole.ESTIMATOR });

    await CallRecord.create(
      Array.from({ length: 15 }, (_, i) => ({
        projectId,
        callDate: new Date(),
        customerName: 'Acme',
        summaryText: `Call ${i + 1}`,
        contributedBy: userId,
        isActive: true,
      })),
    );

    const cookies = await loginAs(ESTIMATOR_EMAIL, ESTIMATOR_PASSWORD);
    const res = await request(app)
      .get(`/api/v1/projects/${projectId}/call-records?page=2&limit=12`)
      .set('Cookie', cookies);

    expect(res.status).toBe(200);
    expect(res.body.data.callRecords).toHaveLength(3);
    expect(res.body.data.pagination).toMatchObject({
      total: 15,
      page: 2,
      limit: 12,
      totalPages: 2,
    });
  });

  it('returns 400 for page=0 (must be positive integer)', async () => {
    const projectId = await seedProject();
    const cookies = await loginAs(ESTIMATOR_EMAIL, ESTIMATOR_PASSWORD);

    const res = await request(app)
      .get(`/api/v1/projects/${projectId}/call-records?page=0`)
      .set('Cookie', cookies);

    expect(res.status).toBe(400);
  });

  it('returns 400 for limit=101 (exceeds max of 100)', async () => {
    const projectId = await seedProject();
    const cookies = await loginAs(ESTIMATOR_EMAIL, ESTIMATOR_PASSWORD);

    const res = await request(app)
      .get(`/api/v1/projects/${projectId}/call-records?limit=101`)
      .set('Cookie', cookies);

    expect(res.status).toBe(400);
  });

  it('soft-deleted records do not appear in the list', async () => {
    const projectId = await seedProject();
    const userId = await seedUser({ email: 'contrib-del@gfs-test.com', password: 'Pass@1234', role: UserRole.ESTIMATOR });

    await CallRecord.create([
      { projectId, callDate: new Date(), customerName: 'Active', summaryText: 'Active record', contributedBy: userId, isActive: true },
      { projectId, callDate: new Date(), customerName: 'Deleted', summaryText: 'Deleted record', contributedBy: userId, isActive: false },
    ]);

    const cookies = await loginAs(ESTIMATOR_EMAIL, ESTIMATOR_PASSWORD);
    const res = await request(app)
      .get(`/api/v1/projects/${projectId}/call-records`)
      .set('Cookie', cookies);

    expect(res.status).toBe(200);
    expect(res.body.data.callRecords).toHaveLength(1);
    expect(res.body.data.callRecords[0].customerName).toBe('Active');
    expect(res.body.data.pagination.total).toBe(1);
  });

  it('returns 404 when project does not exist', async () => {
    const cookies = await loginAs(ESTIMATOR_EMAIL, ESTIMATOR_PASSWORD);

    const res = await request(app)
      .get(`/api/v1/projects/${new mongoose.Types.ObjectId()}/call-records`)
      .set('Cookie', cookies);

    expect(res.status).toBe(404);
  });

  it('returns 401 when not authenticated', async () => {
    const projectId = await seedProject();
    const res = await request(app).get(`/api/v1/projects/${projectId}/call-records`);
    expect(res.status).toBe(401);
  });
});

// ─── GET /:recordId — Get single call record ──────────────────────────────────

describe('GET /api/v1/projects/:projectId/call-records/:recordId', () => {
  it('returns the call record (200)', async () => {
    const projectId = await seedProject();
    const userId = await seedUser({ email: 'contrib2@gfs-test.com', password: 'Pass@1234', role: UserRole.ESTIMATOR });

    const record = await CallRecord.create({
      projectId,
      callDate: new Date(),
      customerName: 'Acme Corp',
      summaryText: 'Call about Series 2000 quote',
      contributedBy: userId,
      isActive: true,
    });

    const cookies = await loginAs(ESTIMATOR_EMAIL, ESTIMATOR_PASSWORD);
    const res = await request(app)
      .get(`/api/v1/projects/${projectId}/call-records/${record._id}`)
      .set('Cookie', cookies);

    expect(res.status).toBe(200);
    expect(res.body.data.callRecord.summaryText).toContain('Series 2000');
    expectNoMongooseInternals(res.body);
  });

  it('returns 404 for a non-existent record', async () => {
    const projectId = await seedProject();
    const cookies = await loginAs(ESTIMATOR_EMAIL, ESTIMATOR_PASSWORD);

    const res = await request(app)
      .get(`/api/v1/projects/${projectId}/call-records/${new mongoose.Types.ObjectId()}`)
      .set('Cookie', cookies);

    expect(res.status).toBe(404);
  });

  it('returns 404 when record belongs to a different project', async () => {
    const projectId = await seedProject();
    const otherProjectId = await seedProject();
    const userId = await seedUser({ email: 'contrib-xproj@gfs-test.com', password: 'Pass@1234', role: UserRole.ESTIMATOR });

    const record = await CallRecord.create({
      projectId: otherProjectId,
      callDate: new Date(),
      customerName: 'Acme Corp',
      summaryText: 'Belongs to other project',
      contributedBy: userId,
      isActive: true,
    });

    const cookies = await loginAs(ESTIMATOR_EMAIL, ESTIMATOR_PASSWORD);
    const res = await request(app)
      .get(`/api/v1/projects/${projectId}/call-records/${record._id}`)
      .set('Cookie', cookies);

    expect(res.status).toBe(404);
  });
});

// ─── PATCH /:recordId — Update call record ────────────────────────────────────

describe('PATCH /api/v1/projects/:projectId/call-records/:recordId', () => {
  it('SALES_MANAGER can update the call record (200)', async () => {
    const projectId = await seedProject();
    const userId = await seedUser({ email: 'contrib3@gfs-test.com', password: 'Pass@1234', role: UserRole.ESTIMATOR });

    const record = await CallRecord.create({
      projectId,
      callDate: new Date(),
      customerName: 'Old Name',
      summaryText: 'Original summary',
      contributedBy: userId,
      isActive: true,
    });

    const cookies = await loginAs(SALES_EMAIL, SALES_PASSWORD);
    const res = await request(app)
      .patch(`/api/v1/projects/${projectId}/call-records/${record._id}`)
      .set('Cookie', cookies)
      .send({ customerName: 'Updated Name' });

    expect(res.status).toBe(200);
    expect(res.body.data.callRecord.customerName).toBe('Updated Name');
  });

  it('ESTIMATOR can also update the call record (200)', async () => {
    const projectId = await seedProject();
    const userId = await seedUser({ email: 'contrib-est@gfs-test.com', password: 'Pass@1234', role: UserRole.ESTIMATOR });

    const record = await CallRecord.create({
      projectId,
      callDate: new Date(),
      customerName: 'Original Name',
      summaryText: 'Original summary',
      contributedBy: userId,
      isActive: true,
    });

    const cookies = await loginAs(ESTIMATOR_EMAIL, ESTIMATOR_PASSWORD);
    const res = await request(app)
      .patch(`/api/v1/projects/${projectId}/call-records/${record._id}`)
      .set('Cookie', cookies)
      .send({ summaryText: 'Updated by estimator' });

    expect(res.status).toBe(200);
    expect(res.body.data.callRecord.summaryText).toBe('Updated by estimator');
  });

  it('returns 400 when body is empty', async () => {
    const projectId = await seedProject();
    const userId = await seedUser({ email: 'contrib4@gfs-test.com', password: 'Pass@1234', role: UserRole.ESTIMATOR });

    const record = await CallRecord.create({
      projectId,
      callDate: new Date(),
      customerName: 'Acme',
      summaryText: 'Summary',
      contributedBy: userId,
      isActive: true,
    });

    const cookies = await loginAs(SALES_EMAIL, SALES_PASSWORD);
    const res = await request(app)
      .patch(`/api/v1/projects/${projectId}/call-records/${record._id}`)
      .set('Cookie', cookies)
      .send({});

    expect(res.status).toBe(400);
  });
});

// ─── DELETE /:recordId — Delete call record ───────────────────────────────────

describe('DELETE /api/v1/projects/:projectId/call-records/:recordId', () => {
  it('soft-deletes the call record and returns it (200)', async () => {
    const projectId = await seedProject();
    const userId = await seedUser({ email: 'contrib5@gfs-test.com', password: 'Pass@1234', role: UserRole.ESTIMATOR });

    const record = await CallRecord.create({
      projectId,
      callDate: new Date(),
      customerName: 'Acme',
      summaryText: 'Summary',
      contributedBy: userId,
      isActive: true,
    });

    const cookies = await loginAs(SALES_EMAIL, SALES_PASSWORD);
    const res = await request(app)
      .delete(`/api/v1/projects/${projectId}/call-records/${record._id}`)
      .set('Cookie', cookies);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.callRecord.isActive).toBe(false);

    const inDb = await CallRecord.findById(record._id);
    expect(inDb?.isActive).toBe(false);
  });

  it('deleted record no longer appears in the list', async () => {
    const projectId = await seedProject();
    const userId = await seedUser({ email: 'contrib5b@gfs-test.com', password: 'Pass@1234', role: UserRole.ESTIMATOR });

    const record = await CallRecord.create({
      projectId,
      callDate: new Date(),
      customerName: 'Acme',
      summaryText: 'Will be deleted',
      contributedBy: userId,
      isActive: true,
    });

    const cookies = await loginAs(SALES_EMAIL, SALES_PASSWORD);
    await request(app)
      .delete(`/api/v1/projects/${projectId}/call-records/${record._id}`)
      .set('Cookie', cookies);

    const listRes = await request(app)
      .get(`/api/v1/projects/${projectId}/call-records`)
      .set('Cookie', cookies);

    expect(listRes.body.data.callRecords).toHaveLength(0);
    expect(listRes.body.data.pagination.total).toBe(0);
  });

  it('returns 403 when ESTIMATOR tries to delete', async () => {
    const projectId = await seedProject();
    const userId = await seedUser({ email: 'contrib6@gfs-test.com', password: 'Pass@1234', role: UserRole.ESTIMATOR });

    const record = await CallRecord.create({
      projectId,
      callDate: new Date(),
      customerName: 'Acme',
      summaryText: 'Summary',
      contributedBy: userId,
      isActive: true,
    });

    const cookies = await loginAs(ESTIMATOR_EMAIL, ESTIMATOR_PASSWORD);
    const res = await request(app)
      .delete(`/api/v1/projects/${projectId}/call-records/${record._id}`)
      .set('Cookie', cookies);

    expect(res.status).toBe(403);
  });
});

// ─── POST /:recordId/extract — AI extraction ──────────────────────────────────

describe('POST /api/v1/projects/:projectId/call-records/:recordId/extract', () => {
  it('triggers AI extraction and returns COMPLETED record (200)', async () => {
    const projectId = await seedProject();
    const userId = await seedUser({ email: 'contrib7@gfs-test.com', password: 'Pass@1234', role: UserRole.ESTIMATOR });

    const record = await CallRecord.create({
      projectId,
      callDate: new Date(),
      customerName: 'Acme Corp',
      summaryText: 'Customer wants 10m x 6m Series 2000 with thermal break and frosted glass.',
      contributedBy: userId,
      isActive: true,
    });

    const cookies = await loginAs(ESTIMATOR_EMAIL, ESTIMATOR_PASSWORD);
    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/call-records/${record._id}/extract`)
      .set('Cookie', cookies);

    expect(res.status).toBe(200);
    expect(res.body.data.callRecord.aiExtractionStatus).toBe(AiExtractionStatus.COMPLETED);
    expect(res.body.data.callRecord.aiExtractedRequirements).toBeTruthy();
    expect(res.body.data.callRecord.aiExtractedAt).toBeTruthy();
  });

  it('triggers AI extraction for a transcriptFileUrl-only record (200)', async () => {
    const projectId = await seedProject();
    const userId = await seedUser({ email: 'contrib7b@gfs-test.com', password: 'Pass@1234', role: UserRole.ESTIMATOR });

    const record = await CallRecord.create({
      projectId,
      callDate: new Date(),
      customerName: 'Acme Corp',
      transcriptFileUrl: 'https://storage.example.com/transcripts/call-001.txt',
      transcriptFileName: 'call-001.txt',
      contributedBy: userId,
      isActive: true,
    });

    const cookies = await loginAs(ESTIMATOR_EMAIL, ESTIMATOR_PASSWORD);
    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/call-records/${record._id}/extract`)
      .set('Cookie', cookies);

    expect(res.status).toBe(200);
    expect(res.body.data.callRecord.aiExtractionStatus).toBe(AiExtractionStatus.COMPLETED);
    expect(res.body.data.callRecord.aiExtractedRequirements).toContain('call-001.txt');
  });

  it('returns 422 when record has no transcript text', async () => {
    const projectId = await seedProject();
    const userId = await seedUser({ email: 'contrib8@gfs-test.com', password: 'Pass@1234', role: UserRole.ESTIMATOR });

    const record = await CallRecord.create({
      projectId,
      callDate: new Date(),
      customerName: 'Acme Corp',
      contributedBy: userId,
      isActive: true,
    });

    const cookies = await loginAs(ESTIMATOR_EMAIL, ESTIMATOR_PASSWORD);
    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/call-records/${record._id}/extract`)
      .set('Cookie', cookies);

    expect(res.status).toBe(422);
  });

  it('returns 409 when extraction is already PENDING', async () => {
    const projectId = await seedProject();
    const userId = await seedUser({ email: 'contrib9@gfs-test.com', password: 'Pass@1234', role: UserRole.ESTIMATOR });

    const record = await CallRecord.create({
      projectId,
      callDate: new Date(),
      customerName: 'Acme Corp',
      summaryText: 'Some summary',
      contributedBy: userId,
      aiExtractionStatus: AiExtractionStatus.PENDING,
      isActive: true,
    });

    const cookies = await loginAs(ESTIMATOR_EMAIL, ESTIMATOR_PASSWORD);
    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/call-records/${record._id}/extract`)
      .set('Cookie', cookies);

    expect(res.status).toBe(409);
  });
});
