import mongoose from "mongoose";
import bcrypt from "bcrypt";
import { assertValidPassword } from "../shared/security/password-policy";

import {
  User,
  UserRole,
  AuthProvider,
} from "../db/models/user.model";

async function main(): Promise<void> {
  const mongoUri = process.env['MONGODB_URI'];
  const seedPassword = "Smartmfg@2026"; // process.env['SEED_ADMIN_PASSWORD'];
  if (!mongoUri) {
    throw new Error('Missing required environment variable: MONGODB_URI');
  }
  if (!seedPassword) {
    throw new Error('Missing required environment variable: SEED_ADMIN_PASSWORD');
  }

  await mongoose.connect(mongoUri);

  console.log("✅ Connected to MongoDB");

  const users = [
    {
      email: "superadmin@smartmfg.com",
      authProvider: AuthProvider.LOCAL,
      role: UserRole.SUPER_ADMIN,
      firstName: "Super",
      lastName: "Admin",
      isActive: true,
    },
    {
      email: "systemadmin@smartmfg.com",
      authProvider: AuthProvider.LOCAL,
      role: UserRole.SYSTEM_ADMIN,
      firstName: "System",
      lastName: "Admin",
      isActive: true,
    },
    {
      email: "salesmanager@smartmfg.com",
      authProvider: AuthProvider.LOCAL,
      role: UserRole.SALES_MANAGER,
      firstName: "Sales",
      lastName: "Manager",
      isActive: true,
    },
    {
      email: "estimator@smartmfg.com",
      authProvider: AuthProvider.LOCAL,
      role: UserRole.ESTIMATOR,
      firstName: "John",
      lastName: "Estimator",
      isActive: true,
    },
  ];

  const bcryptSaltRoundsRaw = Number.parseInt(process.env['BCRYPT_SALT_ROUNDS'] ?? '12', 10);
  const bcryptSaltRounds = Number.isFinite(bcryptSaltRoundsRaw)
    ? Math.min(15, Math.max(10, bcryptSaltRoundsRaw))
    : 12;
  assertValidPassword(seedPassword);
  const passwordHash = await bcrypt.hash(seedPassword, bcryptSaltRounds);

  for (const user of users) {
    await User.findOneAndUpdate(
      { email: user.email },
      { ...user, passwordHash },
      {
        upsert: true,
        new: true,
      }
    );

    console.log(`✅ Seeded ${user.email}`);
  }

  console.log("\n🎉 Users seeded successfully!\n");

  console.log("Login credentials use the password supplied through SEED_ADMIN_PASSWORD.");
  console.log("SUPER_ADMIN  -> superadmin@gfs.com");
  console.log("SYSTEM_ADMIN -> systemadmin@gfs.com");
  console.log("SALES_MANAGER -> salesmanager@gfs.com");
  console.log("ESTIMATOR -> estimator@gfs.com");

  await mongoose.disconnect();

  console.log("\n✅ MongoDB disconnected");

  process.exit(0);
}

main().catch(async (error) => {
  console.error("❌ Seed failed:", error);

  try {
    await mongoose.disconnect();
  } catch {}

  process.exit(1);
});
