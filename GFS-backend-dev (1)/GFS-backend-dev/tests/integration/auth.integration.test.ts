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
import { MongoMemoryServer } from 'mongodb-memory-server';
import { AuthProvider, User, UserRole } from '@db/models/user.model';
import { PasswordResetToken } from '@db/models/password-reset-token.model';
import { expectNoMongooseInternals } from '../support/expect-no-mongoose-internals';

let app: Express;
let mongod: MongoMemoryServer;
let testMongoUri: string;

const ADMIN_EMAIL = 'sysadmin@gfs-test.com';
const ADMIN_PASSWORD = 'Admin@Test123!';
const ESTIMATOR_EMAIL = 'estimator@gfs-test.com';
const ESTIMATOR_PASSWORD = 'Estimator@Test123!';

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
  // Keep auth integration tests isolated from local or deployed database settings.
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  mongod = await MongoMemoryServer.create();
  testMongoUri = mongod.getUri();
  process.env['MONGODB_URI'] = testMongoUri;
  process.env['MAIL_HOST'] = process.env['MAIL_HOST'] ?? 'smtp.test';
  process.env['MAIL_USER'] = process.env['MAIL_USER'] ?? 'test@test.com';
  process.env['MAIL_PASS'] = process.env['MAIL_PASS'] ?? 'test-pass';

  await mongoose.connect(testMongoUri, { serverSelectionTimeoutMS: 4000 });
  const appModule = await import('../../src/app.js');
  app = appModule.app;
});

beforeEach(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(testMongoUri, { serverSelectionTimeoutMS: 4000 });
  }
  sendInviteLinkMock.mockClear();
  sendPasswordResetLinkMock.mockClear();
  await seedUser({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, role: UserRole.SYSTEM_ADMIN });
  await seedUser({ email: ESTIMATOR_EMAIL, password: ESTIMATOR_PASSWORD, role: UserRole.ESTIMATOR });
});

afterEach(async () => {
  if (mongoose.connection.readyState === 1) {
    const emails = [
      ADMIN_EMAIL,
      ESTIMATOR_EMAIL,
      'new.estimator@gfs-test.com',
      'new.sales@gfs-test.com',
      'reset.target@gfs-test.com',
      'invited.target@gfs-test.com',
      'jsheta150@gmail.com',
    ];
    const users = await User.find({ email: { $in: emails } });
    const userIds = users.map((u) => u._id);
    if (userIds.length > 0) {
      await PasswordResetToken.deleteMany({ userId: { $in: userIds } });
    }
    await User.deleteMany({ email: { $in: emails } });
  }
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe('POST /api/v1/auth/login', () => {
  it('returns 200 and sets HttpOnly cookies on valid credentials', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: ESTIMATOR_EMAIL, password: ESTIMATOR_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expectNoMongooseInternals(res.body);
    expect(res.body.data.user.email).toBe(ESTIMATOR_EMAIL);
    expect(res.body.data.user.role).toBe(UserRole.ESTIMATOR);
    expect(res.body.data.user.passwordHash).toBeUndefined();
    expect(res.body.data.user.refreshTokenHash).toBeUndefined();

    const cookies = extractCookies(res);
    expect(cookies.some((c) => c.startsWith('accessToken'))).toBe(true);
    expect(cookies.some((c) => c.startsWith('refreshToken'))).toBe(true);
    expect(cookies.every((c) => c.includes('HttpOnly'))).toBe(true);
  });

  it('returns 401 on wrong password', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: ESTIMATOR_EMAIL, password: 'wrongpassword' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBeFalsy();
  });

  it('returns 401 for non-existent email', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@gfs-test.com', password: ESTIMATOR_PASSWORD });

    expect(res.status).toBe(401);
  });
});

describe('POST /api/v1/auth/register', () => {
  it('returns 401 when called without auth', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'new.estimator@gfs-test.com',
        password: 'Secure!2026X',
        firstName: 'New',
        lastName: 'Estimator',
        role: UserRole.ESTIMATOR,
      });

    expect(res.status).toBe(401);
  });

  it('returns 403 when called by a non-SYSTEM_ADMIN user', async () => {
    const estimatorCookies = await loginAs(ESTIMATOR_EMAIL, ESTIMATOR_PASSWORD);

    const res = await request(app)
      .post('/api/v1/auth/register')
      .set('Cookie', estimatorCookies)
      .send({
        email: 'new.estimator@gfs-test.com',
        password: 'Secure!2026X',
        firstName: 'New',
        lastName: 'Estimator',
        role: UserRole.ESTIMATOR,
      });

    expect(res.status).toBe(403);
  });

  it('returns 201 when called by SYSTEM_ADMIN', async () => {
    const adminCookies = await loginAs(ADMIN_EMAIL, ADMIN_PASSWORD);

    const res = await request(app)
      .post('/api/v1/auth/register')
      .set('Cookie', adminCookies)
      .send({
        email: 'new.estimator@gfs-test.com',
        password: 'Secure!2026X',
        firstName: 'New',
        lastName: 'Estimator',
        role: UserRole.ESTIMATOR,
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  it('creates a SALES_MANAGER when called by SYSTEM_ADMIN', async () => {
    const adminCookies = await loginAs(ADMIN_EMAIL, ADMIN_PASSWORD);

    const res = await request(app)
      .post('/api/v1/auth/register')
      .set('Cookie', adminCookies)
      .send({
        email: 'new.sales@gfs-test.com',
        password: 'Secure!2026Y',
        firstName: 'Sales',
        lastName: 'Manager',
        role: UserRole.SALES_MANAGER,
      });

    expect(res.status).toBe(201);

    const user = await User.findOne({ email: 'new.sales@gfs-test.com' });
    expect(user?.role).toBe(UserRole.SALES_MANAGER);
  });

  it('returns 400 for invalid role', async () => {
    const adminCookies = await loginAs(ADMIN_EMAIL, ADMIN_PASSWORD);

    const res = await request(app)
      .post('/api/v1/auth/register')
      .set('Cookie', adminCookies)
      .send({
        email: 'new.estimator@gfs-test.com',
        password: 'NewUser@123!',
        firstName: 'Bad',
        lastName: 'Role',
        role: 'LAWYER',
      });

    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/auth/me', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns user data after login (no sensitive fields)', async () => {
    const cookies = await loginAs(ESTIMATOR_EMAIL, ESTIMATOR_PASSWORD);

    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Cookie', cookies);

    expect(res.status).toBe(200);
    expectNoMongooseInternals(res.body);
    expect(res.body.data.user.email).toBe(ESTIMATOR_EMAIL);
    expect(res.body.data.user.role).toBe(UserRole.ESTIMATOR);
    expect(res.body.data.user.passwordHash).toBeUndefined();
    expect(res.body.data.user.refreshTokenHash).toBeUndefined();
  });
});

describe('POST /api/v1/auth/refresh-token', () => {
  it('returns 200 and new cookies on valid refresh token', async () => {
    const loginCookies = await loginAs(ESTIMATOR_EMAIL, ESTIMATOR_PASSWORD);

    const res = await request(app)
      .post('/api/v1/auth/refresh-token')
      .set('Cookie', loginCookies);

    expect(res.status).toBe(200);

    const newCookies = extractCookies(res);
    expect(newCookies.some((c) => c.startsWith('accessToken'))).toBe(true);
    expect(newCookies.some((c) => c.startsWith('refreshToken'))).toBe(true);
  });

  it('returns 401 when no refresh token cookie is present', async () => {
    const res = await request(app).post('/api/v1/auth/refresh-token');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/v1/auth/logout', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await request(app).post('/api/v1/auth/logout');
    expect(res.status).toBe(401);
  });

  it('clears cookies and nullifies refreshTokenHash', async () => {
    const cookies = await loginAs(ESTIMATOR_EMAIL, ESTIMATOR_PASSWORD);

    const res = await request(app)
      .post('/api/v1/auth/logout')
      .set('Cookie', cookies);

    expect(res.status).toBe(200);

    const user = await User.findOne({ email: ESTIMATOR_EMAIL }).select('+refreshTokenHash');
    expect(user?.refreshTokenHash).toBeNull();

    const logoutCookies = res.headers['set-cookie'] as string[] | string | undefined;
    if (logoutCookies) {
      const cookieArr = Array.isArray(logoutCookies) ? logoutCookies : [logoutCookies];
      const accessCookie = cookieArr.find((c) => c.startsWith('accessToken'));
      expect(accessCookie).toContain('Expires=Thu, 01 Jan 1970');
    }
  });
});

const extractTokenFromLink = (link: string): string => {
  const m = link.match(/token=([a-f0-9]{64})/);
  if (!m) throw new Error(`No token in link: ${link}`);
  return m[1] as string;
};

describe('POST /api/v1/auth/forgot-password', () => {
  it('returns 200 and sends a reset link for a known LOCAL user', async () => {
    const res = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: ESTIMATOR_EMAIL });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(sendPasswordResetLinkMock).toHaveBeenCalledTimes(1);
    expect(sendPasswordResetLinkMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ESTIMATOR_EMAIL,
        link: expect.stringMatching(/\/reset-password\?token=[a-f0-9]{64}$/),
      }),
    );
  });

  it('returns 200 and sends no email for an unknown address (silent)', async () => {
    const res = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'nobody@gfs-test.com' });

    expect(res.status).toBe(200);
    expect(sendPasswordResetLinkMock).not.toHaveBeenCalled();
  });

  it('returns 400 for a missing or invalid email field', async () => {
    const res = await request(app).post('/api/v1/auth/forgot-password').send({});
    expect(res.status).toBe(400);

    const res2 = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'not-an-email' });
    expect(res2.status).toBe(400);
  });
});

describe('POST /api/v1/auth/set-password (full reset flow)', () => {
  it('lets a user reset password via forgot → set → login', async () => {
    await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: ESTIMATOR_EMAIL });

    const link = sendPasswordResetLinkMock.mock.calls[0]?.[0]?.link as string;
    const rawToken = extractTokenFromLink(link);

    const setRes = await request(app)
      .post('/api/v1/auth/set-password')
      .send({ token: rawToken, password: 'BrandNewPass1!' });

    expect(setRes.status).toBe(200);

    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: ESTIMATOR_EMAIL, password: 'BrandNewPass1!' });

    expect(loginRes.status).toBe(200);
  });

  it('rejects re-using the same token (400)', async () => {
    await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: ESTIMATOR_EMAIL });
    const link = sendPasswordResetLinkMock.mock.calls[0]?.[0]?.link as string;
    const rawToken = extractTokenFromLink(link);

    await request(app)
      .post('/api/v1/auth/set-password')
      .send({ token: rawToken, password: 'BrandNewPass1!' });

    const second = await request(app)
      .post('/api/v1/auth/set-password')
      .send({ token: rawToken, password: 'AnotherPass1!' });

    expect(second.status).toBe(400);
  });

  it('rejects an unknown token (400)', async () => {
    const res = await request(app)
      .post('/api/v1/auth/set-password')
      .send({ token: 'a'.repeat(64), password: 'BrandNewPass1!' });

    expect(res.status).toBe(400);
  });

  it('rejects a password shorter than 8 chars (400)', async () => {
    await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: ESTIMATOR_EMAIL });
    const link = sendPasswordResetLinkMock.mock.calls[0]?.[0]?.link as string;
    const rawToken = extractTokenFromLink(link);

    const res = await request(app)
      .post('/api/v1/auth/set-password')
      .send({ token: rawToken, password: 'short' });

    expect(res.status).toBe(400);
  });

  it('rejects a password containing a meaningful name fragment with a clear message', async () => {
    const email = 'jsheta150@gmail.com';
    await seedUser({
      email,
      password: 'ExistingPass1!',
      role: UserRole.ESTIMATOR,
      firstName: 'Jemunesh',
      lastName: 'Target',
    });

    await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email });
    const link = sendPasswordResetLinkMock.mock.calls[0]?.[0]?.link as string;
    const rawToken = extractTokenFromLink(link);

    const res = await request(app)
      .post('/api/v1/auth/set-password')
      .send({ token: rawToken, password: 'JemuSecure!2026' });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('Password must not contain your name or email address.');
  });
});

describe('Login interplay with invited (passwordless) user', () => {
  it('returns 400 "Account setup pending" when an invited LOCAL user tries to log in before setting a password', async () => {
    await User.create({
      email: 'invited.target@gfs-test.com',
      authProvider: AuthProvider.LOCAL,
      role: UserRole.ESTIMATOR,
      firstName: 'Invited',
      lastName: 'Target',
      isActive: true,
    });

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'invited.target@gfs-test.com', password: 'whatever' });

    expect(res.status).toBe(400);
    expect(res.body.error?.message).toMatch(/Account setup pending/);
  });
});
