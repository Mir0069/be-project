import type { PasswordResetTokenPurpose } from '@db/models/password-reset-token.model';

export interface IPasswordResetTokenRecord {
  id: string;
  userId: string;
  tokenHash: string;
  purpose: PasswordResetTokenPurpose;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ICreatePasswordResetTokenFields {
  userId: string;
  tokenHash: string;
  purpose: PasswordResetTokenPurpose;
  expiresAt: Date;
}

export interface IPasswordResetTokenRepository {
  create(fields: ICreatePasswordResetTokenFields): Promise<IPasswordResetTokenRecord>;
  findActiveByHash(tokenHash: string): Promise<IPasswordResetTokenRecord | null>;
  markConsumed(id: string): Promise<void>;
  deleteOutstanding(userId: string, purpose: PasswordResetTokenPurpose): Promise<void>;
}
