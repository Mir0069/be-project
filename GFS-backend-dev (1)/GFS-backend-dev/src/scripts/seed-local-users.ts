import dotenv from 'dotenv';
dotenv.config();

import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';

import { AuthProvider, User, UserRole } from '../db/models/user.model';
import { assertValidPassword } from '../shared/security/password-policy';

const PASSWORD = "Password123"; // process.env['SEED_LOCAL_PASSWORD'];

const USERS = [
  {
    email: 'salesmanager@gmail.com',
    role: UserRole.SALES_MANAGER,
    firstName: 'Sales',
    lastName: 'Manager',
  },
  {
    email: 'estimator@gmail.com',
    role: UserRole.ESTIMATOR,
    firstName: 'Estimator',
    lastName: 'User',
  },
  {
    email: 'admin@gmail.com',
    role: UserRole.SYSTEM_ADMIN,
    firstName: 'System',
    lastName: 'Admin',
  },
];

async function main(): Promise<void> {
  const uri = process.env['MONGODB_URI'];
  if (!uri) {
    throw new Error('MONGODB_URI is required');
  }
  if (!PASSWORD) {
    throw new Error('SEED_LOCAL_PASSWORD is required');
  }

  for (const user of USERS) {
    assertValidPassword(PASSWORD, user);
  }

  await mongoose.connect(uri);
  console.log(`Connected to MongoDB (${uri})`);

  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  for (const u of USERS) {
    await User.findOneAndUpdate(
      { email: u.email },
      {
        email: u.email,
        passwordHash,
        authProvider: AuthProvider.LOCAL,
        role: u.role,
        firstName: u.firstName,
        lastName: u.lastName,
        isActive: true,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    console.log(`Seeded ${u.role.padEnd(13)} -> ${u.email}`);
  }

  console.log('\nDone. Password supplied through SEED_LOCAL_PASSWORD and not printed.');
  await mongoose.disconnect();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('Seed failed:', err);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
