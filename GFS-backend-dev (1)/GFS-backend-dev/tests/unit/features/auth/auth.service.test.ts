import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { AppError } from '@shared/errors/app.error';
import { AuthProvider, User, UserRole } from '@db/models/user.model';
import { MongooseUserRepository } from '@repositories/mongoose/user.repository';
import { MongoosePasswordResetTokenRepository } from '@repositories/mongoose/password-reset-token.repository';
import type { AuthService } from '@features/auth/auth.service';
import type {
  IMailerService,
  ISendInviteLinkInput,
  ISendMailInput,
  ISendPasswordResetLinkInput,
} from '@shared/mailer/mailer.service';

class NoopMailer implements IMailerService {
  public async sendMail(_input: ISendMailInput): Promise<void> {}
  public async sendInviteLink(_input: ISendInviteLinkInput): Promise<void> {}
  public async sendPasswordResetLink(_input: ISendPasswordResetLinkInput): Promise<void> {}
}

let authService: AuthService;

const TEST_EMAIL = 'estimator@gfs-test.com';
const TEST_PASSWORD = 'GfsSecure!2026';

const seedLocalUser = async (overrides?: Partial<{
  email: string;
  password: string;
  role: UserRole;
  isActive: boolean;
}>): Promise<void> => {
  const passwordHash = await bcrypt.hash(overrides?.password ?? TEST_PASSWORD, 10);
  await User.findOneAndUpdate(
    { email: overrides?.email ?? TEST_EMAIL },
    {
      email: overrides?.email ?? TEST_EMAIL,
      passwordHash,
      authProvider: AuthProvider.LOCAL,
      role: overrides?.role ?? UserRole.ESTIMATOR,
      firstName: 'Test',
      lastName: 'User',
      isActive: overrides?.isActive ?? true,
      refreshTokenHash: null,
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );
};

beforeAll(async () => {
  process.env['JWT_SECRET'] = process.env['JWT_SECRET'] ?? 'test-access-secret';
  process.env['JWT_REFRESH_SECRET'] = process.env['JWT_REFRESH_SECRET'] ?? 'test-refresh-secret';
  process.env['MONGODB_URI'] = process.env['MONGODB_URI'] ?? 'mongodb://127.0.0.1:27017/gfs-test';
  process.env['GOOGLE_CLIENT_ID'] = process.env['GOOGLE_CLIENT_ID'] ?? 'google-client-id';
  process.env['GOOGLE_CLIENT_SECRET'] = process.env['GOOGLE_CLIENT_SECRET'] ?? 'google-client-secret';
  process.env['MICROSOFT_CLIENT_ID'] = process.env['MICROSOFT_CLIENT_ID'] ?? 'microsoft-client-id';
  process.env['MICROSOFT_CLIENT_SECRET'] = process.env['MICROSOFT_CLIENT_SECRET'] ?? 'microsoft-client-secret';
  process.env['MAIL_HOST'] = process.env['MAIL_HOST'] ?? 'smtp.test';
  process.env['MAIL_USER'] = process.env['MAIL_USER'] ?? 'test@test.com';
  process.env['MAIL_PASS'] = process.env['MAIL_PASS'] ?? 'test-pass';

  await mongoose.connect(process.env['MONGODB_URI'] as string, { serverSelectionTimeoutMS: 4000 });

  const { AuthService } = await import('@features/auth/auth.service.js');
  authService = new AuthService(
    new MongooseUserRepository(),
    new MongoosePasswordResetTokenRepository(),
    new NoopMailer(),
  );
});

afterEach(async () => {
  if (mongoose.connection.readyState === 1) {
    await User.deleteMany({
      email: {
        $in: [
          TEST_EMAIL,
          'sales@gfs-test.com',
          'admin@gfs-test.com',
          'oauth@gfs-test.com',
          'duplicate@gfs-test.com',
          'inactive@gfs-test.com',
        ],
      },
    });
  }
});

afterAll(async () => {
  await mongoose.disconnect();
});

describe('AuthService — login', () => {
  it('returns access and refresh tokens for valid credentials', async () => {
    await seedLocalUser();

    const result = await authService.login({ email: TEST_EMAIL, password: TEST_PASSWORD });

    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();

    const user = await User.findOne({ email: TEST_EMAIL }).select('+refreshTokenHash');
    expect(user?.refreshTokenHash).toBeTruthy();
  });

  it('throws 401 when password is wrong', async () => {
    await seedLocalUser();

    await expect(
      authService.login({ email: TEST_EMAIL, password: 'wrongpass' }),
    ).rejects.toThrow(new AppError('Invalid email or password', 401));
  });

  it('throws 401 when user does not exist', async () => {
    await expect(
      authService.login({ email: 'nobody@gfs-test.com', password: TEST_PASSWORD }),
    ).rejects.toThrow(new AppError('Invalid email or password', 401));
  });

  it('throws 400 when email is blank', async () => {
    await expect(
      authService.login({ email: '   ', password: TEST_PASSWORD }),
    ).rejects.toThrow(new AppError('Email and password are required', 400));
  });

  it('throws 400 when password is blank', async () => {
    await expect(
      authService.login({ email: TEST_EMAIL, password: '   ' }),
    ).rejects.toThrow(new AppError('Email and password are required', 400));
  });

  it('throws 400 when user is OAuth-only (no passwordHash)', async () => {
    await User.create({
      email: 'oauth@gfs-test.com',
      authProvider: AuthProvider.MICROSOFT,
      providerId: 'ms-provider-id-999',
      role: UserRole.ESTIMATOR,
      firstName: 'OAuth',
      lastName: 'User',
      isActive: true,
    });

    await expect(
      authService.login({ email: 'oauth@gfs-test.com', password: 'whatever' }),
    ).rejects.toThrow(new AppError('Please login with your OAuth provider', 400));
  });
});

describe('AuthService — register', () => {
  it('creates an ESTIMATOR with a hashed password', async () => {
    await authService.register({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      firstName: 'Jane',
      lastName: 'Estimator',
      role: UserRole.ESTIMATOR,
    });

    const user = await User.findOne({ email: TEST_EMAIL }).select('+passwordHash');
    expect(user?.role).toBe(UserRole.ESTIMATOR);
    expect(user?.authProvider).toBe(AuthProvider.LOCAL);
    expect(user?.passwordHash).toBeTruthy();
  });

  it('creates a SALES_MANAGER', async () => {
    await authService.register({
      email: 'sales@gfs-test.com',
      password: TEST_PASSWORD,
      firstName: 'Sales',
      lastName: 'Manager',
      role: UserRole.SALES_MANAGER,
    });

    const user = await User.findOne({ email: 'sales@gfs-test.com' });
    expect(user?.role).toBe(UserRole.SALES_MANAGER);
  });

  it('creates a SYSTEM_ADMIN', async () => {
    await authService.register({
      email: 'admin@gfs-test.com',
      password: TEST_PASSWORD,
      firstName: 'System',
      lastName: 'Admin',
      role: UserRole.SYSTEM_ADMIN,
    });

    const user = await User.findOne({ email: 'admin@gfs-test.com' });
    expect(user?.role).toBe(UserRole.SYSTEM_ADMIN);
  });

  it('creates a HEAD_OF_DIVISION when a SUPER_ADMIN registers them', async () => {
    await authService.register({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      firstName: 'Head',
      lastName: 'Division',
      role: UserRole.HEAD_OF_DIVISION,
    }, UserRole.SUPER_ADMIN);

    const user = await User.findOne({ email: TEST_EMAIL });
    expect(user?.role).toBe(UserRole.HEAD_OF_DIVISION);
  });

  it.each([UserRole.SYSTEM_ADMIN, UserRole.HEAD_OF_DIVISION, undefined])(
    'throws 403 when %s tries to register a HEAD_OF_DIVISION',
    async (actorRole) => {
      await expect(
        authService.register({
          email: TEST_EMAIL,
          password: TEST_PASSWORD,
          firstName: 'Head',
          lastName: 'Division',
          role: UserRole.HEAD_OF_DIVISION,
        }, actorRole),
      ).rejects.toThrow(expect.objectContaining({ statusCode: 403 }));

      expect(await User.findOne({ email: TEST_EMAIL })).toBeNull();
    },
  );

  it('throws 409 on duplicate email', async () => {
    await seedLocalUser({ email: 'duplicate@gfs-test.com' });

    await expect(
      authService.register({
        email: 'duplicate@gfs-test.com',
        password: TEST_PASSWORD,
        firstName: 'Dup',
        lastName: 'User',
        role: UserRole.ESTIMATOR,
      }),
    ).rejects.toThrow(new AppError('User already exists with this email', 409));
  });

  it('throws 400 for invalid role', async () => {
    await expect(
      authService.register({
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
        firstName: 'Bad',
        lastName: 'Role',
        role: 'LAWYER' as UserRole,
      }),
    ).rejects.toThrow(expect.objectContaining({ statusCode: 400 }));
  });

  it('throws 400 when password does not meet the password policy', async () => {
    await expect(
      authService.register({
        email: TEST_EMAIL,
        password: 'short',
        firstName: 'Test',
        lastName: 'User',
        role: UserRole.ESTIMATOR,
      }),
    ).rejects.toThrow(expect.objectContaining({ statusCode: 400 }));
  });
});

describe('AuthService — refresh', () => {
  it('issues new tokens and updates refresh token hash in DB', async () => {
    await seedLocalUser();
    const { refreshToken } = await authService.login({ email: TEST_EMAIL, password: TEST_PASSWORD });

    const refreshed = await authService.refresh(refreshToken);

    expect(refreshed.accessToken).toBeTruthy();
    expect(refreshed.refreshToken).toBeTruthy();

    const user = await User.findOne({ email: TEST_EMAIL }).select('+refreshTokenHash');
    const isNewHashStored = await bcrypt.compare(refreshed.refreshToken, user?.refreshTokenHash ?? '');
    expect(isNewHashStored).toBe(true);
  });

  it('throws 401 for an invalid refresh token', async () => {
    await expect(authService.refresh('not-a-real-token')).rejects.toThrow(
      new AppError('Invalid or expired refresh token', 401),
    );
  });

  it('throws 401 for a blank refresh token', async () => {
    await expect(authService.refresh('   ')).rejects.toThrow(
      new AppError('Invalid or expired refresh token', 401),
    );
  });
});

describe('AuthService — logout', () => {
  it('clears refreshTokenHash in DB', async () => {
    await seedLocalUser();
    await authService.login({ email: TEST_EMAIL, password: TEST_PASSWORD });
    const user = await User.findOne({ email: TEST_EMAIL });

    await authService.logout(user!._id.toString());

    const updated = await User.findById(user!._id).select('+refreshTokenHash');
    expect(updated?.refreshTokenHash).toBeNull();
  });
});

describe('AuthService — getMe', () => {
  it('returns the active user', async () => {
    await seedLocalUser();
    const user = await User.findOne({ email: TEST_EMAIL });

    const me = await authService.getMe(user!._id.toString());

    expect(me.email).toBe(TEST_EMAIL);
    expect(me.role).toBe(UserRole.ESTIMATOR);
  });

  it('throws 404 for a non-existent user id', async () => {
    await expect(
      authService.getMe(new mongoose.Types.ObjectId().toString()),
    ).rejects.toThrow(new AppError('User not found', 404));
  });
});

describe('AuthService — OAuth', () => {
  it('builds Microsoft consent URL with correct base', () => {
    const url = authService.getOAuthConsentUrl('microsoft', 'test-state-xyz');

    expect(url).toContain('https://login.microsoftonline.com');
    expect(url).toContain('client_id=microsoft-client-id');
    expect(url).toContain('state=test-state-xyz');
  });

  it('builds Google consent URL with correct base', () => {
    const url = authService.getOAuthConsentUrl('google', 'test-state-abc');

    expect(url).toContain('https://accounts.google.com');
    expect(url).toContain('client_id=google-client-id');
  });

  it('throws 400 when OAuth code is empty', async () => {
    await expect(
      authService.loginWithOAuthCode('microsoft', '', UserRole.ESTIMATOR),
    ).rejects.toThrow(new AppError('OAuth code is required', 400));
  });
});
