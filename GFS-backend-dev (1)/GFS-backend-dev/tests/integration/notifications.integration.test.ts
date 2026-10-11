import mongoose from 'mongoose';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import type { Express } from 'express';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { AuthProvider, User, UserRole } from '@db/models/user.model';
import { Notification, NotificationType } from '@db/models/notification.model';
import { MongooseNotificationRepository } from '@repositories/mongoose/notification.repository';

let mongod: MongoMemoryServer;
let app: Express;

const SALES_EMAIL = 'sm@gfs-test.com';
const SALES_PASSWORD = 'Sm@Test123!';
const SALES_EMAIL_2 = 'sm2@gfs-test.com';
const SALES_PASSWORD_2 = 'Sm2@Test123!';
const EST_EMAIL = 'est@gfs-test.com';
const EST_PASSWORD = 'Est@Test123!';

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

const seedNotification = (
  roles: UserRole[],
  overrides: Record<string, unknown> = {},
): Promise<unknown> =>
  Notification.create({
    type: NotificationType.PROJECT_CREATED,
    title: 'New project created',
    message: 'Project GFS-2026-1001 was created for Acme Corp.',
    roles,
    payload: { referenceNumber: 'GFS-2026-1001' },
    ...overrides,
  });

const extractCookies = (res: request.Response): string[] => {
  const cookies = res.headers['set-cookie'];
  if (!cookies) throw new Error('No set-cookie header in response');
  return Array.isArray(cookies) ? cookies : [cookies];
};

const loginAs = async (email: string, password: string): Promise<string[]> => {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  return extractCookies(res);
};

const userIdByEmail = async (email: string): Promise<string> => {
  const user = await User.findOne({ email }).lean();
  return String((user as { _id: unknown })._id);
};

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
  await Notification.deleteMany({});
  await User.deleteMany({});
  await seedUser(SALES_EMAIL, SALES_PASSWORD, UserRole.SALES_MANAGER);
  await seedUser(EST_EMAIL, EST_PASSWORD, UserRole.ESTIMATOR);
});

describe('GET /api/v1/notifications', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/v1/notifications');
    expect(res.status).toBe(401);
  });

  it('lets a sales manager see every notification but an estimator only their own', async () => {
    const estId = await userIdByEmail(EST_EMAIL);
    await seedNotification([UserRole.SALES_MANAGER]);
    await seedNotification([], { userIds: [estId] });

    const smCookies = await loginAs(SALES_EMAIL, SALES_PASSWORD);
    const smRes = await request(app).get('/api/v1/notifications').set('Cookie', smCookies);
    expect(smRes.status).toBe(200);
    expect(smRes.body.success).toBe(true);
    expect(smRes.body.data.items).toHaveLength(2);
    expect(smRes.body.data.items[0]).not.toHaveProperty('readBy');

    const estCookies = await loginAs(EST_EMAIL, EST_PASSWORD);
    const estRes = await request(app).get('/api/v1/notifications').set('Cookie', estCookies);
    expect(estRes.body.data.items).toHaveLength(1);
    expect(estRes.body.data.items[0]).toMatchObject({ type: 'PROJECT_CREATED', isRead: false });
    expect(estRes.body.data.unreadCount).toBe(1);
  });

  it('scopes a proposal approval request to the assigned Sales Manager, not every Sales Manager', async () => {
    await seedUser(SALES_EMAIL_2, SALES_PASSWORD_2, UserRole.SALES_MANAGER);
    const assignedSmId = await userIdByEmail(SALES_EMAIL);

    // A broadcast notification (e.g. PROJECT_CREATED) still reaches every
    // Sales Manager; only the targeted approval request should not.
    await seedNotification([UserRole.SALES_MANAGER]);
    await seedNotification([], {
      type: NotificationType.PROPOSAL_APPROVAL_REQUESTED,
      title: 'Proposal approval requested',
      message: 'Please approve the final pricing.',
      userIds: [assignedSmId],
    });

    const assignedCookies = await loginAs(SALES_EMAIL, SALES_PASSWORD);
    const assignedRes = await request(app).get('/api/v1/notifications').set('Cookie', assignedCookies);
    expect(assignedRes.body.data.items).toHaveLength(2);

    const otherCookies = await loginAs(SALES_EMAIL_2, SALES_PASSWORD_2);
    const otherRes = await request(app).get('/api/v1/notifications').set('Cookie', otherCookies);
    expect(otherRes.body.data.items).toHaveLength(1);
    expect(otherRes.body.data.items[0]).toMatchObject({ type: 'PROJECT_CREATED' });

    const otherCount = await request(app)
      .get('/api/v1/notifications/unread-count')
      .set('Cookie', otherCookies);
    expect(otherCount.body.data.count).toBe(1);
  });
});

describe('GET /api/v1/notifications/unread-count', () => {
  it('counts every unread notification for a sales manager but only their own for an estimator', async () => {
    const estId = await userIdByEmail(EST_EMAIL);
    await seedNotification([UserRole.SALES_MANAGER]);
    await seedNotification([], { userIds: [estId] });

    const smCookies = await loginAs(SALES_EMAIL, SALES_PASSWORD);
    const smRes = await request(app).get('/api/v1/notifications/unread-count').set('Cookie', smCookies);
    expect(smRes.status).toBe(200);
    expect(smRes.body.data.count).toBe(2);

    const estCookies = await loginAs(EST_EMAIL, EST_PASSWORD);
    const estRes = await request(app).get('/api/v1/notifications/unread-count').set('Cookie', estCookies);
    expect(estRes.body.data.count).toBe(1);
  });
});

describe('PATCH /api/v1/notifications/:id/read', () => {
  it('marks read for the caller and drops their unread count', async () => {
    const notification = await seedNotification([UserRole.SALES_MANAGER]);
    const id = String((notification as { _id: unknown })._id);
    const cookies = await loginAs(SALES_EMAIL, SALES_PASSWORD);

    const before = await request(app)
      .get('/api/v1/notifications/unread-count')
      .set('Cookie', cookies);
    expect(before.body.data.count).toBe(1);

    const patch = await request(app)
      .patch(`/api/v1/notifications/${id}/read`)
      .set('Cookie', cookies);
    expect(patch.status).toBe(200);

    const after = await request(app)
      .get('/api/v1/notifications/unread-count')
      .set('Cookie', cookies);
    expect(after.body.data.count).toBe(0);

    const list = await request(app).get('/api/v1/notifications').set('Cookie', cookies);
    expect(list.body.data.items[0].isRead).toBe(true);
  });

  it('returns 404 for an unknown id', async () => {
    const cookies = await loginAs(SALES_EMAIL, SALES_PASSWORD);
    const res = await request(app)
      .patch(`/api/v1/notifications/${new mongoose.Types.ObjectId().toString()}/read`)
      .set('Cookie', cookies);
    expect(res.status).toBe(404);
  });

  it("does not affect another user's read state", async () => {
    const estId = await userIdByEmail(EST_EMAIL);
    const notification = await seedNotification([UserRole.SALES_MANAGER], { userIds: [estId] });
    const id = String((notification as { _id: unknown })._id);

    const smCookies = await loginAs(SALES_EMAIL, SALES_PASSWORD);
    await request(app).patch(`/api/v1/notifications/${id}/read`).set('Cookie', smCookies);

    const estCookies = await loginAs(EST_EMAIL, EST_PASSWORD);
    const estCount = await request(app)
      .get('/api/v1/notifications/unread-count')
      .set('Cookie', estCookies);
    expect(estCount.body.data.count).toBe(1);
  });
});

describe('POST /api/v1/notifications/mark-all-read', () => {
  it('marks every notification for the caller role as read', async () => {
    await seedNotification([UserRole.SALES_MANAGER]);
    await seedNotification([UserRole.SALES_MANAGER]);

    const cookies = await loginAs(SALES_EMAIL, SALES_PASSWORD);
    const res = await request(app).post('/api/v1/notifications/mark-all-read').set('Cookie', cookies);

    expect(res.status).toBe(200);
    expect(res.body.data.modified).toBe(2);

    const after = await request(app)
      .get('/api/v1/notifications/unread-count')
      .set('Cookie', cookies);
    expect(after.body.data.count).toBe(0);
  });
});

describe('completion notification idempotency', () => {
  it('stores only one completion notification when completion is retried concurrently', async () => {
    const repository = new MongooseNotificationRepository();
    const dedupeKey = 'PROJECT_COMPLETED:507f1f77bcf86cd799439011';
    const fields = {
      type: NotificationType.PROJECT_COMPLETED,
      title: 'Project completed',
      message: 'The final Excel proposal is ready.',
      projectId: '507f1f77bcf86cd799439011',
      roles: [UserRole.SALES_MANAGER, UserRole.ESTIMATOR],
      userIds: [],
      dedupeKey,
    };

    await Notification.init();
    const results = await Promise.all([
      repository.createIfAbsent(fields),
      repository.createIfAbsent(fields),
    ]);

    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(await Notification.countDocuments({ dedupeKey })).toBe(1);
  });
});
