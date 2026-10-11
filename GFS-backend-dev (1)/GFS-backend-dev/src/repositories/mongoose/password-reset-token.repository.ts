import type { HydratedDocument } from 'mongoose';
import { Types } from 'mongoose';
import {
  PasswordResetToken,
  type IPasswordResetToken,
  type PasswordResetTokenPurpose,
} from '@db/models/password-reset-token.model';
import type {
  ICreatePasswordResetTokenFields,
  IPasswordResetTokenRecord,
  IPasswordResetTokenRepository,
} from '@repositories/interfaces/i-password-reset-token.repository';

export class MongoosePasswordResetTokenRepository implements IPasswordResetTokenRepository {
  public async create(
    fields: ICreatePasswordResetTokenFields,
  ): Promise<IPasswordResetTokenRecord> {
    const token = await PasswordResetToken.create({
      userId: new Types.ObjectId(fields.userId),
      tokenHash: fields.tokenHash,
      purpose: fields.purpose,
      expiresAt: fields.expiresAt,
    });
    return this.toDomain(token);
  }

  public async findActiveByHash(tokenHash: string): Promise<IPasswordResetTokenRecord | null> {
    const token = await PasswordResetToken.findOne({
      tokenHash,
      consumedAt: null,
      expiresAt: { $gt: new Date() },
    });
    return token ? this.toDomain(token) : null;
  }

  public async markConsumed(id: string): Promise<void> {
    await PasswordResetToken.findByIdAndUpdate(id, { consumedAt: new Date() });
  }

  public async deleteOutstanding(
    userId: string,
    purpose: PasswordResetTokenPurpose,
  ): Promise<void> {
    await PasswordResetToken.deleteMany({
      userId: new Types.ObjectId(userId),
      purpose,
      consumedAt: null,
    });
  }

  private toDomain(token: HydratedDocument<IPasswordResetToken>): IPasswordResetTokenRecord {
    return {
      id: token._id.toString(),
      userId: token.userId.toString(),
      tokenHash: token.tokenHash,
      purpose: token.purpose,
      expiresAt: token.expiresAt,
      consumedAt: token.consumedAt ?? null,
      createdAt: token.createdAt,
      updatedAt: token.updatedAt,
    };
  }
}
