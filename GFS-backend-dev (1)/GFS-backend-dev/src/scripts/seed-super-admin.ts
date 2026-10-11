import dotenv from 'dotenv';
dotenv.config();

import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { AuthProvider, User, UserRole } from '../db/models/user.model';
import { assertValidPassword } from '../shared/security/password-policy';

const SUPER_ADMIN_EMAIL = 'tanushree@amberflux.com';
const SUPER_ADMIN_PASSWORD = process.env['SUPER_ADMIN_PASSWORD'];
const SUPER_ADMIN_FIRST_NAME = 'Tanushree'; 
const SUPER_ADMIN_LAST_NAME = 'Arora';

async function seedSuperAdmin(): Promise<void> {
  if (!process.env['MONGODB_URI']) {
    throw new Error('MONGODB_URI is required');
  }

  if (!SUPER_ADMIN_PASSWORD) {
    throw new Error('SUPER_ADMIN_PASSWORD is required');
  }
  assertValidPassword(SUPER_ADMIN_PASSWORD, {
    email: SUPER_ADMIN_EMAIL,
    firstName: SUPER_ADMIN_FIRST_NAME,
    lastName: SUPER_ADMIN_LAST_NAME,
  });

  await mongoose.connect(process.env['MONGODB_URI']);
  console.log('Connected to MongoDB');

  const existing = await User.findOne({ email: SUPER_ADMIN_EMAIL });
  if (existing) {
    console.log(`SUPER_ADMIN already exists: ${SUPER_ADMIN_EMAIL}`);
    return;
  }

  const passwordHash = await bcrypt.hash(SUPER_ADMIN_PASSWORD, 12);

  await User.create({
    email: SUPER_ADMIN_EMAIL,
    passwordHash,
    authProvider: AuthProvider.LOCAL,
    role: UserRole.SUPER_ADMIN,
    firstName: SUPER_ADMIN_FIRST_NAME,
    lastName: SUPER_ADMIN_LAST_NAME,
    isActive: true,
  });

  console.log(`SUPER_ADMIN created: ${SUPER_ADMIN_EMAIL}`);
}

seedSuperAdmin()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(() => void mongoose.disconnect());
