import mongoose from 'mongoose';
import { AppError } from '@shared/errors/app.error';
import { AuthProvider, User, UserRole } from '@db/models/user.model';
import { PasswordResetToken, PasswordResetTokenPurpose } from '@db/models/password-reset-token.model';
import { MongooseUserRepository } from '@repositories/mongoose/user.repository';
import { MongoosePasswordResetTokenRepository } from '@repositories/mongoose/password-reset-token.repository';
import type { UsersService } from '@features/users/users.service';
import type {
  IMailerService,
  ISendInviteLinkInput,
  ISendMailInput,
  ISendPasswordResetLinkInput,
} from '@shared/mailer/mailer.service';

class FakeMailer implements IMailerService {
  public sentInvites: ISendInviteLinkInput[] = [];
  public sentResets: ISendPasswordResetLinkInput[] = [];
  public shouldThrow = false;

  public async sendMail(_input: ISendMailInput): Promise<void> {
    if (this.shouldThrow) throw new Error('SMTP down');
  }

  public async sendInviteLink(input: ISendInviteLinkInput): Promise<void> {
    if (this.shouldThrow) throw new Error('SMTP down');
    this.sentInvites.push(input);
  }

  public async sendPasswordResetLink(input: ISendPasswordResetLinkInput): Promise<void> {
    if (this.shouldThrow) throw new Error('SMTP down');
    this.sentResets.push(input);
  }
}

let usersService: UsersService;
let mailer: FakeMailer;

const estimatorFixture = {
  firstName: 'estimator FN',
  lastName: 'estimator LN',
  email: 'testingestimator@gmail.com',
  role: UserRole.ESTIMATOR as UserRole.ESTIMATOR,
};

const salesManagerFixture = {
  firstName: 'salesmanager FN',
  lastName: 'salesmanager LN',
  email: 'testingsalesmanager@gmail.com',
  role: UserRole.SALES_MANAGER as UserRole.SALES_MANAGER,
};

beforeAll(async () => {
  process.env['JWT_SECRET'] = process.env['JWT_SECRET'] ?? 'test-access-secret';
  process.env['JWT_REFRESH_SECRET'] = process.env['JWT_REFRESH_SECRET'] ?? 'test-refresh-secret';
  process.env['MONGODB_URI'] = process.env['MONGODB_URI'] ?? 'mongodb://127.0.0.1:27017/gfs-test';
  process.env['MAIL_HOST'] = process.env['MAIL_HOST'] ?? 'smtp.test';
  process.env['MAIL_USER'] = process.env['MAIL_USER'] ?? 'test@test.com';
  process.env['MAIL_PASS'] = process.env['MAIL_PASS'] ?? 'test-pass';

  await mongoose.connect(process.env['MONGODB_URI'] as string, { serverSelectionTimeoutMS: 4000 });

  const { UsersService } = await import('@features/users/users.service.js');
  mailer = new FakeMailer();
  usersService = new UsersService(
    new MongooseUserRepository(),
    new MongoosePasswordResetTokenRepository(),
    mailer,
  );
});

afterEach(async () => {
  if (mongoose.connection.readyState === 1) {
    const users = await User.find({
      email: { $in: [estimatorFixture.email, salesManagerFixture.email] },
    });
    const userIds = users.map((u) => u._id);
    if (userIds.length > 0) {
      await PasswordResetToken.deleteMany({ userId: { $in: userIds } });
    }
    await User.deleteMany({
      email: { $in: [estimatorFixture.email, salesManagerFixture.email] },
    });
  }
  mailer.sentInvites = [];
  mailer.sentResets = [];
  mailer.shouldThrow = false;
});

afterAll(async () => {
  await mongoose.disconnect();
});

describe('UsersService — createUser', () => {
  it('creates an ESTIMATOR with no passwordHash and issues an INVITE token', async () => {
    const result = await usersService.createUser(estimatorFixture, { role: UserRole.SUPER_ADMIN } as any);

    expect(result.user.email).toBe(estimatorFixture.email);
    expect(result.user.role).toBe(UserRole.ESTIMATOR);
    expect(result.user.firstName).toBe(estimatorFixture.firstName);
    expect(result.user.lastName).toBe(estimatorFixture.lastName);
    expect(result.inviteSent).toBe(true);
    expect(result).not.toHaveProperty('password');

    const stored = await User.findOne({ email: estimatorFixture.email }).select('+passwordHash');
    expect(stored).not.toBeNull();
    expect(stored!.authProvider).toBe(AuthProvider.LOCAL);
    expect(stored!.isActive).toBe(true);
    expect(stored!.passwordHash).toBeUndefined();

    const tokens = await PasswordResetToken.find({ userId: stored!._id });
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.purpose).toBe(PasswordResetTokenPurpose.INVITE);
    expect(tokens[0]?.consumedAt).toBeNull();
    expect(tokens[0]?.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('creates a SALES_MANAGER', async () => {
    const result = await usersService.createUser(salesManagerFixture, { role: UserRole.SUPER_ADMIN } as any);
    expect(result.user.role).toBe(UserRole.SALES_MANAGER);
    const stored = await User.findOne({ email: salesManagerFixture.email });
    expect(stored?.role).toBe(UserRole.SALES_MANAGER);
  });

  it('sends an invite-link email containing the role and a set-password URL', async () => {
    await usersService.createUser(estimatorFixture, { role: UserRole.SUPER_ADMIN } as any);

    expect(mailer.sentInvites).toHaveLength(1);
    expect(mailer.sentInvites[0]?.to).toBe(estimatorFixture.email);
    expect(mailer.sentInvites[0]?.firstName).toBe(estimatorFixture.firstName);
    expect(mailer.sentInvites[0]?.role).toBe(UserRole.ESTIMATOR);
    expect(mailer.sentInvites[0]?.link).toMatch(/\/set-password\?token=[a-f0-9]{64}$/);
  });

  it('returns inviteSent=false when mailer throws but still creates the user and token', async () => {
    mailer.shouldThrow = true;

    const result = await usersService.createUser(estimatorFixture, { role: UserRole.SUPER_ADMIN } as any);

    expect(result.inviteSent).toBe(false);
    const stored = await User.findOne({ email: estimatorFixture.email });
    expect(stored).not.toBeNull();
    const tokens = await PasswordResetToken.find({ userId: stored!._id });
    expect(tokens).toHaveLength(1);
  });

  it('throws 409 when email already exists', async () => {
    await usersService.createUser(estimatorFixture, { role: UserRole.SUPER_ADMIN } as any);

    await expect(usersService.createUser(estimatorFixture, { role: UserRole.SUPER_ADMIN } as any)).rejects.toThrow(
      new AppError('User already exists with this email', 409),
    );
  });

  it('normalizes the email and trims names', async () => {
    const result = await usersService.createUser(
      {
        ...estimatorFixture,
        email: '  TestingEstimator@gmail.com  ',
        firstName: '  estimator FN  ',
        lastName: '  estimator LN  ',
      },
      { role: UserRole.SUPER_ADMIN } as any
    );

    expect(result.user.email).toBe('testingestimator@gmail.com');
    expect(result.user.firstName).toBe('estimator FN');
    expect(result.user.lastName).toBe('estimator LN');
  });
});

describe('UsersService — listUsers', () => {
  it('returns all users with public fields only', async () => {
    await usersService.createUser(estimatorFixture, { role: UserRole.SUPER_ADMIN } as any);
    await usersService.createUser(salesManagerFixture, { role: UserRole.SUPER_ADMIN } as any);

    const users = await usersService.listUsers({ role: UserRole.SUPER_ADMIN } as any);
    const emails = users.map((u) => u.email);
    expect(emails).toContain(estimatorFixture.email);
    expect(emails).toContain(salesManagerFixture.email);

    const estimator = users.find((u) => u.email === estimatorFixture.email);
    expect(estimator).toMatchObject({
      firstName: estimatorFixture.firstName,
      lastName: estimatorFixture.lastName,
      email: estimatorFixture.email,
      role: UserRole.ESTIMATOR,
    });
    expect(estimator).not.toHaveProperty('passwordHash');
    expect(estimator).not.toHaveProperty('refreshTokenHash');
  });
});
