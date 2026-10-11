import dotenv from 'dotenv';
dotenv.config();

import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { AuthProvider, User, UserRole } from '../db/models/user.model';
import { assertValidPassword } from '../shared/security/password-policy';

const EMAIL = 'systemadmin@gmail.com';
const PASSWORD = process.env['SYSTEM_ADMIN_PASSWORD'];
const FIRST_NAME = 'System';
const LAST_NAME = 'Admin';

async function seedSystemAdmin(): Promise<void> {
  if (!process.env['MONGODB_URI']) {
    throw new Error('MONGODB_URI is required');
  }
  if (!PASSWORD) {
    throw new Error('SYSTEM_ADMIN_PASSWORD is required');
  }
  assertValidPassword(PASSWORD, {
    email: EMAIL,
    firstName: FIRST_NAME,
    lastName: LAST_NAME,
  });

  await mongoose.connect(process.env['MONGODB_URI']);
  console.log('Connected to MongoDB');

  const passwordHash = await bcrypt.hash(PASSWORD, 12);

  const existing = await User.findOne({ email: EMAIL });
  if (existing) {
    existing.passwordHash = passwordHash;
    existing.role = UserRole.SYSTEM_ADMIN;
    existing.authProvider = AuthProvider.LOCAL;
    existing.isActive = true;
    if (!existing.firstName) existing.firstName = FIRST_NAME;
    if (!existing.lastName) existing.lastName = LAST_NAME;
    await existing.save();
    console.log(`SYSTEM_ADMIN updated (password reset): ${EMAIL}`);
    return;
  }

  await User.create({
    email: EMAIL,
    passwordHash,
    authProvider: AuthProvider.LOCAL,
    role: UserRole.SYSTEM_ADMIN,
    firstName: FIRST_NAME,
    lastName: LAST_NAME,
    isActive: true,
  });

  console.log(`SYSTEM_ADMIN created: ${EMAIL}`);
}

seedSystemAdmin()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(() => void mongoose.disconnect());
