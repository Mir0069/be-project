import dotenv from 'dotenv';
dotenv.config();

import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { AuthProvider, User, UserRole } from '../db/models/user.model';
import { assertValidPassword } from '../shared/security/password-policy';

const SEED_PASSWORD = process.env['SEED_DEMO_PASSWORD'];

const DEMO_USERS = [
  {
    email: 'tanushree@amberflux.com',
    role: UserRole.SUPER_ADMIN,
    firstName: 'Tanushree',
    lastName: 'Arora',
  },
  {
    email: 'estimator@gfs.com',
    role: UserRole.ESTIMATOR, // Assuming ESTIMATOR matches your UserRole enum definition
    firstName: 'Ethan',
    lastName: 'Estimator',
  },
  {
    email: 'sales@gfs.com',
    role: UserRole.SALES_MANAGER, // Assuming SALES_MANAGER matches your UserRole enum definition
    firstName: 'Sarah',
    lastName: 'Sales',
  }
];

async function seedDemoUsers(): Promise<void> {
  if (!process.env['MONGODB_URI']) {
    throw new Error('MONGODB_URI is required');
  }
  if (!SEED_PASSWORD) {
    throw new Error('SEED_DEMO_PASSWORD is required');
  }

  for (const userConfig of DEMO_USERS) {
    assertValidPassword(SEED_PASSWORD, userConfig);
  }

  await mongoose.connect(process.env['MONGODB_URI']);
  console.log('Connected to MongoDB');

  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 12);

  for (const userConfig of DEMO_USERS) {
    const existing = await User.findOne({ email: userConfig.email });
    if (existing) {
      console.log(`User already exists: ${userConfig.email} (${userConfig.role})`);
      continue;
    }

    await User.create({
      email: userConfig.email,
      passwordHash,
      authProvider: AuthProvider.LOCAL,
      role: userConfig.role,
      firstName: userConfig.firstName,
      lastName: userConfig.lastName,
      isActive: true,
    });

    console.log(`Successfully created ${userConfig.role}: ${userConfig.email}`);
  }
}

seedDemoUsers()
  .catch((err) => {
    console.error('Demo seeding failed:', err);
    process.exit(1);
  })
  .finally(() => void mongoose.disconnect());
