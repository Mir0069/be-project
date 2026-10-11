import { StatusCodes } from 'http-status-codes';
import { env } from '@config/index';
import { AppError } from '@shared/errors/app.error';
import { ErrorCode } from '@shared/errors/error-codes';
import { AuthProvider, UserRole } from '@db/models/user.model';
import { PasswordResetTokenPurpose } from '@db/models/password-reset-token.model';
import type { IAuthUser } from '@features/auth/auth.types';
import type { IUserRepository } from '@repositories/interfaces/i-user.repository';
import type { IPasswordResetTokenRepository } from '@repositories/interfaces/i-password-reset-token.repository';
import type { IMailerService } from '@shared/mailer/mailer.service';
import { generateRawToken, hashToken } from '@shared/utils/generate-token';
import { canManageRole, hasAnyRole } from '@shared/security/role-access';
import type {
  ICreateUserRequest,
  ICreateUserResult,
  IEditUserRequest,
  IPublicUser,
} from './users.types';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export class UsersService {
  private readonly userRepository: IUserRepository;
  private readonly passwordResetTokenRepository: IPasswordResetTokenRepository;
  private readonly mailerService: IMailerService;

  public constructor(
    userRepository: IUserRepository,
    passwordResetTokenRepository: IPasswordResetTokenRepository,
    mailerService: IMailerService,
  ) {
    this.userRepository = userRepository;
    this.passwordResetTokenRepository = passwordResetTokenRepository;
    this.mailerService = mailerService;
  }

  public async createUser(input: ICreateUserRequest, currentUser: { role: UserRole }): Promise<ICreateUserResult> {
    if (this.isSystemAdmin(currentUser.role) && input.role === UserRole.SUPER_ADMIN) {
      throw new AppError('System Admin cannot create Super Admin', StatusCodes.FORBIDDEN, true, { code: ErrorCode.FORBIDDEN });
    }

    this.assertCanManageRole(currentUser.role, input.role, 'Only Super Admin can create Head of Division');

    const email = input.email.trim().toLowerCase();
    const firstName = input.firstName.trim();
    const lastName = input.lastName.trim();

    const existing = await this.userRepository.findByEmail(email);
    if (existing) {
      throw new AppError(
        'User already exists with this email',
        StatusCodes.CONFLICT,
        true,
        { code: ErrorCode.CONFLICT },
      );
    }

    const created = await this.userRepository.create({
      email,
      authProvider: AuthProvider.LOCAL,
      role: input.role,
      firstName,
      lastName,
    });

    const rawToken = generateRawToken();
    await this.passwordResetTokenRepository.create({
      userId: created.id,
      tokenHash: hashToken(rawToken),
      purpose: PasswordResetTokenPurpose.INVITE,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    });

    const link = `${env.app.frontendUrl}/set-password?token=${rawToken}`;

    let inviteSent = true;
    try {
      await this.mailerService.sendInviteLink({
        to: email,
        firstName,
        role: input.role,
        link,
      });
    } catch (error) {
      inviteSent = false;
      console.error('Failed to send invite email', {
        email,
        error: error instanceof Error ? error.message : error,
      });
    }

    return {
      user: this.toPublicUser(created),
      inviteSent,
    };
  }

  public async listUsers(currentUser: { role: UserRole }): Promise<IPublicUser[]> {
    let users = await this.userRepository.findAll();
    if (this.isSystemAdmin(currentUser.role)) {
      users = users.filter((u) => u.role !== UserRole.SUPER_ADMIN);
    }
    return users.map((user) => this.toPublicUser(user));
  }

  public async listEstimators(): Promise<IPublicUser[]> {
    const users = await this.userRepository.findAll();
    const estimators = users.filter((u) => hasAnyRole(u.role, [UserRole.ESTIMATOR]) && u.isActive);
    return estimators.map((user) => this.toPublicUser(user));
  }

  public async listSalesManagers(): Promise<IPublicUser[]> {
    const users = await this.userRepository.findAll();
    const salesManagers = users.filter((u) => hasAnyRole(u.role, [UserRole.SALES_MANAGER]) && u.isActive);
    return salesManagers.map((user) => this.toPublicUser(user));
  }

  public async editUser(id: string, input: IEditUserRequest, currentUser: { role: UserRole }): Promise<IPublicUser> {
    const user = await this.userRepository.findById(id);
    if (!user) {
      throw new AppError('User not found', StatusCodes.NOT_FOUND, true);
    }

    if (this.isSystemAdmin(currentUser.role) && user.role === UserRole.SUPER_ADMIN) {
      throw new AppError('System Admin cannot edit Super Admin', StatusCodes.FORBIDDEN, true, { code: ErrorCode.FORBIDDEN });
    }

    if (this.isSystemAdmin(currentUser.role) && input.role === UserRole.SUPER_ADMIN) {
      throw new AppError('System Admin cannot assign Super Admin role', StatusCodes.FORBIDDEN, true, { code: ErrorCode.FORBIDDEN });
    }

    this.assertCanManageRole(currentUser.role, user.role, 'Only Super Admin can edit Head of Division');
    this.assertCanManageRole(currentUser.role, input.role, 'Only Super Admin can assign Head of Division role');

    await this.userRepository.updateById(id, {
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      role: input.role,
    });

    const updatedUser = await this.userRepository.findById(id);
    return this.toPublicUser(updatedUser!);
  }

  public async disableUser(id: string, currentUser: { role: UserRole }): Promise<IPublicUser> {
    const user = await this.userRepository.findById(id);
    if (!user) {
      throw new AppError('User not found', StatusCodes.NOT_FOUND, true);
    }

    if (this.isSystemAdmin(currentUser.role) && user.role === UserRole.SUPER_ADMIN) {
      throw new AppError('System Admin cannot disable Super Admin', StatusCodes.FORBIDDEN, true, { code: ErrorCode.FORBIDDEN });
    }

    this.assertCanManageRole(currentUser.role, user.role, 'Only Super Admin can disable Head of Division');

    await this.userRepository.updateById(id, {
      isActive: !user.isActive,
    });

    const updatedUser = await this.userRepository.findById(id);
    return this.toPublicUser(updatedUser!);
  }

  public async resetUserPassword(id: string, currentUser: { role: UserRole }): Promise<void> {
    const user = await this.userRepository.findById(id);
    if (!user) {
      throw new AppError('User not found', StatusCodes.NOT_FOUND, true);
    }

    if (this.isSystemAdmin(currentUser.role) && user.role === UserRole.SUPER_ADMIN) {
      throw new AppError('System Admin cannot reset password for Super Admin', StatusCodes.FORBIDDEN, true, { code: ErrorCode.FORBIDDEN });
    }

    this.assertCanManageRole(currentUser.role, user.role, 'Only Super Admin can reset password for Head of Division');

    const rawToken = generateRawToken();
    await this.passwordResetTokenRepository.create({
      userId: user.id,
      tokenHash: hashToken(rawToken),
      purpose: PasswordResetTokenPurpose.RESET,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    });

    const link = `${env.app.frontendUrl}/set-password?token=${rawToken}`;

    await this.mailerService.sendPasswordResetLink({
      to: user.email,
      firstName: user.firstName,
      link,
    });
  }

  // Head of Division inherits System Admin, so it gets the same Super Admin limits.
  private isSystemAdmin(role: UserRole): boolean {
    return hasAnyRole(role, [UserRole.SYSTEM_ADMIN]);
  }

  private assertCanManageRole(actorRole: UserRole, targetRole: UserRole, message: string): void {
    if (!canManageRole(actorRole, targetRole)) {
      throw new AppError(message, StatusCodes.FORBIDDEN, true, { code: ErrorCode.FORBIDDEN });
    }
  }

  private toPublicUser(user: IAuthUser): IPublicUser {
    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
    };
  }
}
