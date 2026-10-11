import mongoose, { Document, Schema } from 'mongoose';

export enum UserRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  ESTIMATOR = 'ESTIMATOR',
  SALES_MANAGER = 'SALES_MANAGER',
  SYSTEM_ADMIN = 'SYSTEM_ADMIN',
  HEAD_OF_DIVISION = 'HEAD_OF_DIVISION',
}

export enum AuthProvider {
  LOCAL = 'LOCAL',
  MICROSOFT = 'MICROSOFT',
  GOOGLE = 'GOOGLE',
}

export interface IUser extends Document {
  email: string;
  passwordHash?: string;
  authProvider: AuthProvider;
  providerId?: string | null;
  role: UserRole;
  firstName: string;
  lastName: string;
  isActive: boolean;
  refreshTokenHash?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: {
      type: String,
    },
    authProvider: {
      type: String,
      enum: Object.values(AuthProvider),
      required: true,
      default: AuthProvider.LOCAL,
    },
    providerId: {
      type: String,
      required: false,
      default: null,
    },
    role: {
      type: String,
      enum: Object.values(UserRole),
      required: true,
    },
    firstName: {
      type: String,
      required: true,
      trim: true,
    },
    lastName: {
      type: String,
      required: true,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    refreshTokenHash: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

UserSchema.index({ role: 1, isActive: 1 });
UserSchema.index(
  { authProvider: 1, providerId: 1 },
  {
    unique: true,
    partialFilterExpression: { providerId: { $type: 'string' } },
  },
);

UserSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ((ret as unknown) as Record<string, unknown>)['passwordHash'];
    delete ((ret as unknown) as Record<string, unknown>)['refreshTokenHash'];
    return ret;
  },
});

export const User = mongoose.model<IUser>('User', UserSchema);
