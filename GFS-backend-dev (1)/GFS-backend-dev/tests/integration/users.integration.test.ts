const sendMailMock = jest.fn().mockResolvedValue(undefined);
const sendInviteLinkMock = jest.fn().mockResolvedValue(undefined);
const sendPasswordResetLinkMock = jest.fn().mockResolvedValue(undefined);

jest.mock('@shared/mailer/index', () => ({
  mailerService: {
    sendMail: sendMailMock,
    sendInviteLink: sendInviteLinkMock,
    sendPasswordResetLink: sendPasswordResetLinkMock,
  },
}));

import mongoose from 'mongoose';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import type { Express } from 'express';
import { AuthProvider, User, UserRole } from '@db/models/user.model';
import { PasswordResetToken } from '@db/models/password-reset-token.model';
import { expectNoMongooseInternals } from '../support/expect-no-mongoose-internals';

let app: Express;

const ADMIN_EMAIL = 'sysadmin@gfs-test.com';
const ADMIN_PASSWORD = 'Admin@Test123!';
const ESTIMATOR_LOGIN_EMAIL = 'estimator@gfs-test.com';
const ESTIMATOR_LOGIN_PASSWORD = 'Estimator@Test123!';

const estimatorFixture = {
  firstName: 'estimator FN',
  lastName: 'estimator LN',
  email: 'testingestimator@gmail.com',
  role: UserRole.ESTIMATOR,
};

const salesManagerFixture = {
  firstName: 'salesmanager FN',
  lastName: 'salesmanager LN',
  email: 'testingsalesmanager@gmail.com',
  role: UserRole.SALES_MANAGER,
};

const seedUser = async (overrides: {
  email: string;
  password: string;
  role: UserRole;
  firstName?: string;
  lastName?: string;
}): Promise<void> => {
  const passwordHash = await bcrypt.hash(overrides.password, 10);
  await User.findOneAndUpdate(
    { email: overrides.email },
    {
      email: overrides.email,
      passwordHash,
      authProvider: AuthProvider.LOCAL,
      role: overrides.role,
      firstName: overrides.firstName ?? 'Test',
      lastName: overrides.lastName ?? 'User',
      isActive: true,
      refreshTokenHash: null,
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );
};

const extractCookies = (res: request.Response): string[] => {
  const cookies = res.headers['set-cookie'];
  if (!cookies) throw new Error('No set-cookie header in response');
  return Array.isArray(cookies) ? cookies : [cookies];
};

const loginAs = async (email: string, password: string): Promise<string[]> => {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  return extractCookies(res);
};

beforeAll(async () => {
  process.env['JWT_SECRET'] = process.env['JWT_SECRET'] ?? 'test-access-secret';
  process.env['JWT_REFRESH_SECRET'] = process.env['JWT_REFRESH_SECRET'] ?? 'test-refresh-secret';
  process.env['MONGODB_URI'] = process.env['MONGODB_URI'] ?? 'mongodb://127.0.0.1:27017/gfs-test';
  process.env['MAIL_HOST'] = process.env['MAIL_HOST'] ?? 'smtp.test';
  process.env['MAIL_USER'] = process.env['MAIL_USER'] ?? 'test@test.com';
  process.env['MAIL_PASS'] = process.env['MAIL_PASS'] ?? 'test-pass';

  const appModule = await import('../../src/app.js');
  app = appModule.app;

  await mongoose.connect(process.env['MONGODB_URI'] as string, { serverSelectionTimeoutMS: 4000 });
});

beforeEach(async () => {
  if (mongoose.connection.readyState === 1) {
    await seedUser({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, role: UserRole.SYSTEM_ADMIN });
    await seedUser({
      email: ESTIMATOR_LOGIN_EMAIL,
      password: ESTIMATOR_LOGIN_PASSWORD,
      role: UserRole.ESTIMATOR,
    });
  }
  sendMailMock.mockClear();
  sendInviteLinkMock.mockClear();
  sendPasswordResetLinkMock.mockClear();
});

afterEach(async () => {
  if (mongoose.connection.readyState === 1) {
    const userDocs = await User.find({
      email: {
        $in: [
          ADMIN_EMAIL,
          ESTIMATOR_LOGIN_EMAIL,
          estimatorFixture.email,
          salesManagerFixture.email,
        ],
      },
    });
    const userIds = userDocs.map((u) => u._id);
    if (userIds.length > 0) {
      await PasswordResetToken.deleteMany({ userId: { $in: userIds } });
    }
    await User.deleteMany({
      email: {
        $in: [
          ADMIN_EMAIL,
          ESTIMATOR_LOGIN_EMAIL,
          estimatorFixture.email,
          salesManagerFixture.email,
        ],
      },
    });
  }
});

afterAll(async () => {
  await mongoose.disconnect();
});

describe('POST /api/v1/users/createuser', () => {
  it('returns 401 when called without auth', async () => {
    const res = await request(app).post('/api/v1/users/createuser').send(estimatorFixture);
    expect(res.status).toBe(401);
  });

  it('returns 403 when called by a non-admin (ESTIMATOR)', async () => {
    const cookies = await loginAs(ESTIMATOR_LOGIN_EMAIL, ESTIMATOR_LOGIN_PASSWORD);
    const res = await request(app)
      .post('/api/v1/users/createuser')
      .set('Cookie', cookies)
      .send(estimatorFixture);

    expect(res.status).toBe(403);
  });

  it('creates an ESTIMATOR with no password and sends invite link', async () => {
    const adminCookies = await loginAs(ADMIN_EMAIL, ADMIN_PASSWORD);

    const res = await request(app)
      .post('/api/v1/users/createuser')
      .set('Cookie', adminCookies)
      .send(estimatorFixture);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user).toMatchObject({
      firstName: estimatorFixture.firstName,
      lastName: estimatorFixture.lastName,
      email: estimatorFixture.email,
      role: UserRole.ESTIMATOR,
    });
    expect(res.body.data.inviteSent).toBe(true);
    expect(res.body.data).not.toHaveProperty('password');
    expectNoMongooseInternals(res.body);

    const stored = await User.findOne({ email: estimatorFixture.email }).select('+passwordHash');
    expect(stored?.passwordHash).toBeUndefined();

    expect(sendInviteLinkMock).toHaveBeenCalledTimes(1);
    expect(sendInviteLinkMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: estimatorFixture.email,
        firstName: estimatorFixture.firstName,
        role: UserRole.ESTIMATOR,
        link: expect.stringMatching(/\/set-password\?token=[a-f0-9]{64}$/),
      }),
    );

    const tokens = await PasswordResetToken.find({ userId: stored!._id });
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.purpose).toBe('INVITE');
  });

  it('creates a SALES_MANAGER', async () => {
    const adminCookies = await loginAs(ADMIN_EMAIL, ADMIN_PASSWORD);
    const res = await request(app)
      .post('/api/v1/users/createuser')
      .set('Cookie', adminCookies)
      .send(salesManagerFixture);

    expect(res.status).toBe(201);
    expect(res.body.data.user.role).toBe(UserRole.SALES_MANAGER);
  });

  it('returns 409 for a duplicate email', async () => {
    const adminCookies = await loginAs(ADMIN_EMAIL, ADMIN_PASSWORD);
    await request(app)
      .post('/api/v1/users/createuser')
      .set('Cookie', adminCookies)
      .send(estimatorFixture);

    const res = await request(app)
      .post('/api/v1/users/createuser')
      .set('Cookie', adminCookies)
      .send(estimatorFixture);

    expect(res.status).toBe(409);
  });

  it('returns 400 for an invalid role (SYSTEM_ADMIN not allowed via this endpoint)', async () => {
    const adminCookies = await loginAs(ADMIN_EMAIL, ADMIN_PASSWORD);
    const res = await request(app)
      .post('/api/v1/users/createuser')
      .set('Cookie', adminCookies)
      .send({ ...estimatorFixture, role: UserRole.SYSTEM_ADMIN });

    expect(res.status).toBe(400);
  });

  it('returns 400 for missing fields', async () => {
    const adminCookies = await loginAs(ADMIN_EMAIL, ADMIN_PASSWORD);
    const res = await request(app)
      .post('/api/v1/users/createuser')
      .set('Cookie', adminCookies)
      .send({ email: 'x@y.com' });

    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/users/getalluser', () => {
  it('returns 401 when called without auth', async () => {
    const res = await request(app).get('/api/v1/users/getalluser');
    expect(res.status).toBe(401);
  });

  it('returns 403 when called by a non-admin (ESTIMATOR)', async () => {
    const cookies = await loginAs(ESTIMATOR_LOGIN_EMAIL, ESTIMATOR_LOGIN_PASSWORD);
    const res = await request(app)
      .get('/api/v1/users/getalluser')
      .set('Cookie', cookies);

    expect(res.status).toBe(403);
  });

  it('returns 200 with all users (firstName, lastName, email, role) when called by SYSTEM_ADMIN', async () => {
    const adminCookies = await loginAs(ADMIN_EMAIL, ADMIN_PASSWORD);

    await request(app)
      .post('/api/v1/users/createuser')
      .set('Cookie', adminCookies)
      .send(estimatorFixture);
    await request(app)
      .post('/api/v1/users/createuser')
      .set('Cookie', adminCookies)
      .send(salesManagerFixture);

    const res = await request(app)
      .get('/api/v1/users/getalluser')
      .set('Cookie', adminCookies);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expectNoMongooseInternals(res.body);

    const users: Array<{ email: string; role: UserRole; firstName: string; lastName: string }> =
      res.body.data.users;

    const emails = users.map((u) => u.email);
    expect(emails).toContain(estimatorFixture.email);
    expect(emails).toContain(salesManagerFixture.email);

    const estimator = users.find((u) => u.email === estimatorFixture.email);
    expect(estimator).toMatchObject({
      firstName: estimatorFixture.firstName,
      lastName: estimatorFixture.lastName,
      role: UserRole.ESTIMATOR,
    });

    users.forEach((u) => {
      expect(u).not.toHaveProperty('passwordHash');
      expect(u).not.toHaveProperty('refreshTokenHash');
    });
  });
});
