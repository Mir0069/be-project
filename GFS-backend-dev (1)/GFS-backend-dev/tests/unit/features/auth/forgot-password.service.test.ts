import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { AuthProvider, User, UserRole } from '@db/models/user.model';
import { PasswordResetToken, PasswordResetTokenPurpose } from '@db/models/password-reset-token.model';
import { MongooseUserRepository } from '@repositories/mongoose/user.repository';
import { MongoosePasswordResetTokenRepository } from '@repositories/mongoose/password-reset-token.repository';
import { hashToken } from '@shared/utils/generate-token';
import type { AuthService } from '@features/auth/auth.service';
import type {
  IMailerService,
  ISendInviteLinkInput,
  ISendMailInput,
  ISendPasswordResetLinkInput,
} from '@shared/mailer/mailer.service';

class CapturingMailer implements IMailerService {
  public resets: ISendPasswordResetLinkInput[] = [];

  public async sendMail(_input: ISendMailInput): Promise<void> {}
  public async sendInviteLink(_input: ISendInviteLinkInput): Promise<void> {}
  public async sendPasswordResetLink(input: ISendPasswordResetLinkInput): Promise<void> {
    this.resets.push(input);
  }
}

let authService: AuthService;
let mailer: CapturingMailer;

const TEST_EMAIL = 'forgot.target@gfs-test.com';
const OAUTH_EMAIL = 'forgot.oauth@gfs-test.com';

const seedLocal = async (): Promise<void> => {
  const passwordHash = await bcrypt.hash('OriginalPass1', 10);
  await User.findOneAndUpdate(
    { email: TEST_EMAIL },
    {
      email: TEST_EMAIL,
      passwordHash,
      authProvider: AuthProvider.LOCAL,
      role: UserRole.ESTIMATOR,
      firstName: 'Forgot',
      lastName: 'Target',
      isActive: true,
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );
};

const seedOAuth = async (): Promise<void> => {
  await User.findOneAndUpdate(
    { email: OAUTH_EMAIL },
    {
      email: OAUTH_EMAIL,
      authProvider: AuthProvider.GOOGLE,
      providerId: 'google-provider-id-xyz',
      role: UserRole.ESTIMATOR,
      firstName: 'OAuth',
      lastName: 'User',
      isActive: true,
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );
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
  mailer = new CapturingMailer();
  authService = new AuthService(
    new MongooseUserRepository(),
    new MongoosePasswordResetTokenRepository(),
    mailer,
  );
});

afterEach(async () => {
  if (mongoose.connection.readyState === 1) {
    const users = await User.find({ email: { $in: [TEST_EMAIL, OAUTH_EMAIL] } });
    const userIds = users.map((u) => u._id);
    if (userIds.length > 0) {
      await PasswordResetToken.deleteMany({ userId: { $in: userIds } });
    }
    await User.deleteMany({ email: { $in: [TEST_EMAIL, OAUTH_EMAIL] } });
  }
  mailer.resets = [];
});

afterAll(async () => {
  await mongoose.disconnect();
});

describe('AuthService — forgotPassword', () => {
  it('issues a RESET token and emails the reset link for a LOCAL user', async () => {
    await seedLocal();
    await authService.forgotPassword(TEST_EMAIL);

    const user = await User.findOne({ email: TEST_EMAIL });
    const tokens = await PasswordResetToken.find({ userId: user!._id });
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.purpose).toBe(PasswordResetTokenPurpose.RESET);
    expect(tokens[0]?.consumedAt).toBeNull();
    expect(tokens[0]?.expiresAt.getTime()).toBeGreaterThan(Date.now());

    expect(mailer.resets).toHaveLength(1);
    expect(mailer.resets[0]?.to).toBe(TEST_EMAIL);
    expect(mailer.resets[0]?.link).toMatch(/\/reset-password\?token=[a-f0-9]{64}$/);
  });

  it('deletes outstanding RESET tokens before issuing a new one', async () => {
    await seedLocal();
    await authService.forgotPassword(TEST_EMAIL);
    await authService.forgotPassword(TEST_EMAIL);

    const user = await User.findOne({ email: TEST_EMAIL });
    const tokens = await PasswordResetToken.find({ userId: user!._id });
    expect(tokens).toHaveLength(1);
  });

  it('does nothing silently for an unknown email', async () => {
    await authService.forgotPassword('nobody@gfs-test.com');

    const tokens = await PasswordResetToken.find({});
    expect(tokens.filter((t) => t.purpose === PasswordResetTokenPurpose.RESET)).toHaveLength(0);
    expect(mailer.resets).toHaveLength(0);
  });

  it('does nothing for an OAuth-provider user', async () => {
    await seedOAuth();
    await authService.forgotPassword(OAUTH_EMAIL);

    const user = await User.findOne({ email: OAUTH_EMAIL });
    const tokens = await PasswordResetToken.find({ userId: user!._id });
    expect(tokens).toHaveLength(0);
    expect(mailer.resets).toHaveLength(0);
  });

  it('normalizes the email (case + whitespace) before lookup', async () => {
    await seedLocal();
    await authService.forgotPassword(`  ${TEST_EMAIL.toUpperCase()}  `);

    expect(mailer.resets).toHaveLength(1);
  });

  it('persists tokenHash (not raw) — raw only appears in the link', async () => {
    await seedLocal();
    await authService.forgotPassword(TEST_EMAIL);

    const rawFromLink = mailer.resets[0]!.link.split('token=')[1] as string;
    const user = await User.findOne({ email: TEST_EMAIL });
    const tokenDoc = await PasswordResetToken.findOne({ userId: user!._id });

    expect(tokenDoc?.tokenHash).toBe(hashToken(rawFromLink));
    expect(tokenDoc?.tokenHash).not.toBe(rawFromLink);
  });
});
