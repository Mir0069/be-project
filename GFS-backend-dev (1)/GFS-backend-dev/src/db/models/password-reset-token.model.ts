import mongoose, { Document, Schema, Types } from 'mongoose';

export enum PasswordResetTokenPurpose {
  INVITE = 'INVITE',
  RESET = 'RESET',
}

export interface IPasswordResetToken extends Document {
  userId: Types.ObjectId;
  tokenHash: string;
  purpose: PasswordResetTokenPurpose;
  expiresAt: Date;
  consumedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const PasswordResetTokenSchema = new Schema<IPasswordResetToken>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    tokenHash: {
      type: String,
      required: true,
      unique: true,
    },
    purpose: {
      type: String,
      enum: Object.values(PasswordResetTokenPurpose),
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    consumedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

PasswordResetTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const PasswordResetToken = mongoose.model<IPasswordResetToken>(
  'PasswordResetToken',
  PasswordResetTokenSchema,
);
