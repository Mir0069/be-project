import { StatusCodes } from 'http-status-codes';
import { AuthProvider, UserRole } from '@db/models/user.model';
import type { IAuthUser } from '@features/auth/auth.types';
import type { UsersService } from '@features/users/users.service';
import type { ICreateUserFields, IUpdateUserFields, IUserRepository } from '@repositories/interfaces/i-user.repository';
import type { IPasswordResetTokenRepository } from '@repositories/interfaces/i-password-reset-token.repository';
import type { IMailerService } from '@shared/mailer/mailer.service';

class InMemoryUserRepository implements IUserRepository {
  public users: IAuthUser[] = [];

  public async findByEmail(email: string) {
    return this.users.find((user) => user.email === email) ?? null;
  }

  public async findById(id: string) {
    return this.users.find((user) => user.id === id) ?? null;
  }

  public async findByProviderId() {
    return null;
  }

  public async findByEmailWithPassword(email: string) {
    return this.findByEmail(email);
  }

  public async findByIdWithRefreshToken(id: string) {
    return this.findById(id);
  }

  public async updateById(id: string, fields: IUpdateUserFields) {
    const user = this.users.find((entry) => entry.id === id);
    if (user) Object.assign(user, fields);
  }

  public async create(fields: ICreateUserFields) {
    const user = seedUser(`user-${this.users.length + 1}`, fields.role, { email: fields.email });
    this.users.push(user);
    return user;
  }

  public async findAll() {
    return [...this.users];
  }
}

const seedUser = (id: string, role: UserRole, overrides: Partial<IAuthUser> = {}): IAuthUser => ({
  id,
  email: `${id}@gfs.test`,
  authProvider: AuthProvider.LOCAL,
  role,
  firstName: 'First',
  lastName: 'Last',
  isActive: true,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
});

const SUPER_ADMIN = { role: UserRole.SUPER_ADMIN };
const SYSTEM_ADMIN = { role: UserRole.SYSTEM_ADMIN };
const HEAD_OF_DIVISION = { role: UserRole.HEAD_OF_DIVISION };

const newHeadOfDivision = {
  firstName: 'Head',
  lastName: 'Division',
  email: 'hod@gfs.test',
  role: UserRole.HEAD_OF_DIVISION as const,
};

let usersService: UsersService;
let userRepository: InMemoryUserRepository;
let mailer: jest.Mocked<IMailerService>;

beforeAll(() => {
  process.env['JWT_SECRET'] = process.env['JWT_SECRET'] ?? 'test-access-secret';
  process.env['JWT_REFRESH_SECRET'] = process.env['JWT_REFRESH_SECRET'] ?? 'test-refresh-secret';
  process.env['MONGODB_URI'] = process.env['MONGODB_URI'] ?? 'mongodb://127.0.0.1:27017/gfs-test';
});

beforeEach(async () => {
  const { UsersService: Service } = await import('@features/users/users.service.js');
  userRepository = new InMemoryUserRepository();
  mailer = {
    sendMail: jest.fn(),
    sendInviteLink: jest.fn(),
    sendPasswordResetLink: jest.fn(),
  };
  const tokenRepository = { create: jest.fn() } as unknown as IPasswordResetTokenRepository;
  usersService = new Service(userRepository, tokenRepository, mailer);
});

const expectForbidden = async (promise: Promise<unknown>, message: string) => {
  await expect(promise).rejects.toMatchObject({ statusCode: StatusCodes.FORBIDDEN, message });
};

describe('UsersService — Head of Division', () => {
  describe('createUser', () => {
    it('lets a Super Admin create a Head of Division and invites them with that role', async () => {
      const result = await usersService.createUser(newHeadOfDivision, SUPER_ADMIN);

      expect(result.user.role).toBe(UserRole.HEAD_OF_DIVISION);
      expect(mailer.sendInviteLink).toHaveBeenCalledWith(
        expect.objectContaining({ to: newHeadOfDivision.email, role: UserRole.HEAD_OF_DIVISION }),
      );
    });

    it.each([
      ['System Admin', SYSTEM_ADMIN],
      ['Head of Division', HEAD_OF_DIVISION],
    ])('stops a %s from creating a Head of Division', async (_label, actor) => {
      await expectForbidden(
        usersService.createUser(newHeadOfDivision, actor),
        'Only Super Admin can create Head of Division',
      );
      expect(userRepository.users).toHaveLength(0);
    });

    it('lets a Head of Division create estimators and sales managers', async () => {
      const estimator = await usersService.createUser(
        { ...newHeadOfDivision, email: 'est@gfs.test', role: UserRole.ESTIMATOR },
        HEAD_OF_DIVISION,
      );
      const manager = await usersService.createUser(
        { ...newHeadOfDivision, email: 'sm@gfs.test', role: UserRole.SALES_MANAGER },
        HEAD_OF_DIVISION,
      );

      expect(estimator.user.role).toBe(UserRole.ESTIMATOR);
      expect(manager.user.role).toBe(UserRole.SALES_MANAGER);
    });

    it('stops a Head of Division from creating a Super Admin, like a System Admin', async () => {
      await expectForbidden(
        usersService.createUser({ ...newHeadOfDivision, role: UserRole.SUPER_ADMIN }, HEAD_OF_DIVISION),
        'System Admin cannot create Super Admin',
      );
    });
  });

  describe('listUsers', () => {
    it('hides Super Admins from a Head of Division', async () => {
      userRepository.users = [
        seedUser('super', UserRole.SUPER_ADMIN),
        seedUser('hod', UserRole.HEAD_OF_DIVISION),
        seedUser('est', UserRole.ESTIMATOR),
      ];

      const users = await usersService.listUsers(HEAD_OF_DIVISION);

      expect(users.map((user) => user.id)).toEqual(['hod', 'est']);
    });

    it('still shows everyone to a Super Admin', async () => {
      userRepository.users = [seedUser('super', UserRole.SUPER_ADMIN), seedUser('hod', UserRole.HEAD_OF_DIVISION)];

      const users = await usersService.listUsers(SUPER_ADMIN);

      expect(users.map((user) => user.id)).toEqual(['super', 'hod']);
    });
  });

  describe('listEstimators', () => {
    it('includes active Heads of Division so they can be assigned to projects', async () => {
      userRepository.users = [
        seedUser('est', UserRole.ESTIMATOR),
        seedUser('hod', UserRole.HEAD_OF_DIVISION),
        seedUser('hod-off', UserRole.HEAD_OF_DIVISION, { isActive: false }),
        seedUser('sm', UserRole.SALES_MANAGER),
        seedUser('admin', UserRole.SYSTEM_ADMIN),
      ];

      const estimators = await usersService.listEstimators();

      expect(estimators.map((user) => user.id)).toEqual(['est', 'hod']);
    });
  });

  describe('editUser', () => {
    const edit = (role: UserRole) => ({ firstName: 'New', lastName: 'Name', role });

    it('lets a Super Admin promote a user to Head of Division', async () => {
      userRepository.users = [seedUser('est', UserRole.ESTIMATOR)];

      const updated = await usersService.editUser('est', edit(UserRole.HEAD_OF_DIVISION), SUPER_ADMIN);

      expect(updated.role).toBe(UserRole.HEAD_OF_DIVISION);
    });

    it.each([
      ['System Admin', SYSTEM_ADMIN],
      ['Head of Division', HEAD_OF_DIVISION],
    ])('stops a %s from assigning the Head of Division role', async (_label, actor) => {
      userRepository.users = [seedUser('est', UserRole.ESTIMATOR)];

      await expectForbidden(
        usersService.editUser('est', edit(UserRole.HEAD_OF_DIVISION), actor),
        'Only Super Admin can assign Head of Division role',
      );
      expect(userRepository.users[0]?.role).toBe(UserRole.ESTIMATOR);
    });

    it.each([
      ['System Admin', SYSTEM_ADMIN],
      ['Head of Division', HEAD_OF_DIVISION],
    ])('stops a %s from editing a Head of Division', async (_label, actor) => {
      userRepository.users = [seedUser('hod', UserRole.HEAD_OF_DIVISION)];

      await expectForbidden(
        usersService.editUser('hod', edit(UserRole.ESTIMATOR), actor),
        'Only Super Admin can edit Head of Division',
      );
      expect(userRepository.users[0]?.role).toBe(UserRole.HEAD_OF_DIVISION);
    });

    it('stops a Head of Division from editing a Super Admin', async () => {
      userRepository.users = [seedUser('super', UserRole.SUPER_ADMIN)];

      await expectForbidden(
        usersService.editUser('super', edit(UserRole.SUPER_ADMIN), HEAD_OF_DIVISION),
        'System Admin cannot edit Super Admin',
      );
    });

    it('lets a Head of Division edit an estimator', async () => {
      userRepository.users = [seedUser('est', UserRole.ESTIMATOR)];

      const updated = await usersService.editUser('est', edit(UserRole.SALES_MANAGER), HEAD_OF_DIVISION);

      expect(updated.role).toBe(UserRole.SALES_MANAGER);
    });
  });

  describe('disableUser and resetUserPassword', () => {
    it('stops a System Admin from disabling or resetting a Head of Division', async () => {
      userRepository.users = [seedUser('hod', UserRole.HEAD_OF_DIVISION)];

      await expectForbidden(
        usersService.disableUser('hod', SYSTEM_ADMIN),
        'Only Super Admin can disable Head of Division',
      );
      await expectForbidden(
        usersService.resetUserPassword('hod', SYSTEM_ADMIN),
        'Only Super Admin can reset password for Head of Division',
      );
      expect(userRepository.users[0]?.isActive).toBe(true);
      expect(mailer.sendPasswordResetLink).not.toHaveBeenCalled();
    });

    it('lets a Super Admin disable and reset a Head of Division', async () => {
      userRepository.users = [seedUser('hod', UserRole.HEAD_OF_DIVISION)];

      const disabled = await usersService.disableUser('hod', SUPER_ADMIN);
      await usersService.resetUserPassword('hod', SUPER_ADMIN);

      expect(disabled.isActive).toBe(false);
      expect(mailer.sendPasswordResetLink).toHaveBeenCalledTimes(1);
    });

    it('stops a Head of Division from disabling a Super Admin', async () => {
      userRepository.users = [seedUser('super', UserRole.SUPER_ADMIN)];

      await expectForbidden(
        usersService.disableUser('super', HEAD_OF_DIVISION),
        'System Admin cannot disable Super Admin',
      );
    });
  });
});
