import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { AppError } from '@shared/errors/app.error';
import { AuthProvider, User, UserRole } from '@db/models/user.model';
import { PasswordResetToken, PasswordResetTokenPurpose } from '@db/models/password-reset-token.model';
import { MongooseUserRepository } from '@repositories/mongoose/user.repository';
import { MongoosePasswordResetTokenRepository } from '@repositories/mongoose/password-reset-token.repository';
import { generateRawToken, hashToken } from '@shared/utils/generate-token';
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

const TEST_EMAIL = 'setpw.target@gfs-test.com';

const seedInvitedUser = async (): Promise<{ userId: string; rawToken: string }> => {
  const user = await User.create({
    email: TEST_EMAIL,
    authProvider: AuthProvider.LOCAL,
    role: UserRole.ESTIMATOR,
    firstName: 'Invitee',
    lastName: 'Target',
    isActive: true,
  });
  const raw = generateRawToken();
  await PasswordResetToken.create({
    userId: user._id,
    tokenHash: hashToken(raw),
    purpose: PasswordResetTokenPurpose.INVITE,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
  return { userId: user._id.toString(), rawToken: raw };
};

beforeAll(async () => {
  process.env['JWT_SECRET'] = process.env['JWT_SECRET'] ?? 'test-access-secret';
  process.env['JWT_REFRESH_SECRET'] = process.env['JWT_REFRESH_SECRET'] ?? 'test-refresh-secret';
  process.env['MONGODB_URI'] = process.env['MONGODB_URI'] ?? 'mongodb://127.0.0.1:27017/gfs-test';
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
    const users = await User.find({ email: TEST_EMAIL });
    const userIds = users.map((u) => u._id);
    if (userIds.length > 0) {
      await PasswordResetToken.deleteMany({ userId: { $in: userIds } });
    }
    await User.deleteMany({ email: TEST_EMAIL });
  }
});

afterAll(async () => {
  await mongoose.disconnect();
});

describe('AuthService — setPassword', () => {
  it('sets the password, marks the token consumed, and the user can log in', async () => {
    const { rawToken } = await seedInvitedUser();

    await authService.setPassword(rawToken, 'GfsSecure!2026');

    const updated = await User.findOne({ email: TEST_EMAIL }).select('+passwordHash');
    expect(updated?.passwordHash).toBeTruthy();
    const ok = await bcrypt.compare('GfsSecure!2026', updated!.passwordHash!);
    expect(ok).toBe(true);

    const tokens = await PasswordResetToken.find({ userId: updated!._id });
    expect(tokens[0]?.consumedAt).not.toBeNull();

    const tokenResult = await authService.login({ email: TEST_EMAIL, password: 'GfsSecure!2026' });
    expect(tokenResult.accessToken).toBeTruthy();
  });

  it('rejects an already-consumed token', async () => {
    const { rawToken } = await seedInvitedUser();
    await authService.setPassword(rawToken, 'GfsSecure!2026');

    await expect(authService.setPassword(rawToken, 'AnotherSecure!2026')).rejects.toThrow(
      new AppError('Invalid or expired token', 400),
    );
  });

  it('rejects an expired token', async () => {
    const user = await User.create({
      email: TEST_EMAIL,
      authProvider: AuthProvider.LOCAL,
      role: UserRole.ESTIMATOR,
      firstName: 'Expired',
      lastName: 'Target',
      isActive: true,
    });
    const raw = generateRawToken();
    await PasswordResetToken.create({
      userId: user._id,
      tokenHash: hashToken(raw),
      purpose: PasswordResetTokenPurpose.INVITE,
      expiresAt: new Date(Date.now() - 60 * 1000),
    });

    await expect(authService.setPassword(raw, 'GfsSecure!2026')).rejects.toThrow(
      new AppError('Invalid or expired token', 400),
    );
  });

  it('rejects an unknown token', async () => {
    await expect(authService.setPassword('not-a-real-token', 'GfsSecure!2026')).rejects.toThrow(
      new AppError('Invalid or expired token', 400),
    );
  });

  it('rejects passwords that do not meet the password policy', async () => {
    const { rawToken } = await seedInvitedUser();
    await expect(authService.setPassword(rawToken, 'short')).rejects.toThrow(
      expect.objectContaining({ statusCode: 400 }),
    );
  });

  it('rejects a blank token', async () => {
    await expect(authService.setPassword('   ', 'GfsSecure!2026')).rejects.toThrow(
      new AppError('Invalid or expired token', 400),
    );
  });
});

describe('AuthService — login interplay', () => {
  it('refuses LOCAL invited user with no passwordHash with "Account setup pending"', async () => {
    await User.create({
      email: TEST_EMAIL,
      authProvider: AuthProvider.LOCAL,
      role: UserRole.ESTIMATOR,
      firstName: 'Invitee',
      lastName: 'Target',
      isActive: true,
    });

    await expect(
      authService.login({ email: TEST_EMAIL, password: 'anything-goes' }),
    ).rejects.toThrow(
      new AppError(
        'Account setup pending. Please use the setup link emailed to you.',
        400,
      ),
    );
  });
});
