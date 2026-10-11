import type { HydratedDocument } from 'mongoose';
import { User } from '@db/models/user.model';
import type { AuthProvider, IUser } from '@db/models/user.model';
import type { IAuthUser } from '@features/auth/auth.types';
import type {
  ICreateUserFields,
  IUpdateUserFields,
  IUserRepository,
} from '@repositories/interfaces/i-user.repository';

export class MongooseUserRepository implements IUserRepository {
  public async findByEmail(email: string): Promise<IAuthUser | null> {
    const user = await User.findOne({ email: email.toLowerCase() });
    return user ? this.toDomain(user) : null;
  }

  public async findByProviderId(
    provider: AuthProvider,
    providerId: string,
  ): Promise<IAuthUser | null> {
    const user = await User.findOne({ authProvider: provider, providerId });
    return user ? this.toDomain(user) : null;
  }

  public async findById(id: string): Promise<IAuthUser | null> {
    const user = await User.findById(id);
    return user ? this.toDomain(user) : null;
  }

  public async findByEmailWithPassword(email: string): Promise<IAuthUser | null> {
    const user = await User.findOne({ email: email.toLowerCase() }).select('+passwordHash');
    return user ? this.toDomain(user) : null;
  }

  public async findByIdWithRefreshToken(id: string): Promise<IAuthUser | null> {
    const user = await User.findById(id).select('+refreshTokenHash');
    return user ? this.toDomain(user) : null;
  }

  public async updateById(id: string, fields: IUpdateUserFields): Promise<void> {
    await User.findByIdAndUpdate(id, fields);
  }

  public async create(fields: ICreateUserFields): Promise<IAuthUser> {
    const user = await User.create(fields);
    return this.toDomain(user);
  }

  public async findAll(): Promise<IAuthUser[]> {
    const users = await User.find({}).sort({ createdAt: -1 });
    return users.map((user) => this.toDomain(user));
  }

  private toDomain(user: HydratedDocument<IUser>): IAuthUser {
    return {
      id: user._id.toString(),
      email: user.email,
      authProvider: user.authProvider,
      providerId: user.providerId,
      role: user.role,
      firstName: user.firstName,
      lastName: user.lastName,
      isActive: user.isActive,
      passwordHash: user.passwordHash,
      refreshTokenHash: user.refreshTokenHash,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
