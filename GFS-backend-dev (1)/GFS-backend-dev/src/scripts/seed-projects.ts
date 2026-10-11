import mongoose from "mongoose";
import * as dotenv from "dotenv";
import path from "path";

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

import { Project, ProjectStatus, ProjectType } from "../db/models/project.model";
import { User, UserRole } from "../db/models/user.model";

async function main(): Promise<void> {
  const mongoUri = process.env["MONGODB_URI"] || process.env["MONGO_URI"];
  if (!mongoUri) {
    throw new Error("MONGODB_URI is required");
  }

  await mongoose.connect(mongoUri);
  console.log("✅ Connected to MongoDB");

  // Fetch an estimator to assign some projects
  const estimator = await User.findOne({ role: UserRole.ESTIMATOR });

  if (!estimator) {
    console.log("⚠️ No estimator found. Seed users first if you want assigned projects.");
  }

  const estimatorId = estimator ? estimator._id : null;

  const projects = [
    {
      referenceNumber: "PRJ-1001",
      projectName: "Downtown Highrise Window Replacements",
      customerName: "Acme Corp",
      status: ProjectStatus.SETUP_PENDING,
      projectType: ProjectType.NEW_ESTIMATE,
      jobAddress: "123 Main St, New York, NY",
      assignedEstimators: estimatorId ? [estimatorId] : [],
      isActive: true,
    },
    {
      referenceNumber: "PRJ-1002",
      projectName: "Sunnyvale Mall Storefront",
      customerName: "Retail Spaces Inc.",
      status: ProjectStatus.WAITING_FOR_INPUTS,
      projectType: ProjectType.RE_QUOTE,
      jobAddress: "456 Market St, San Francisco, CA",
      assignedEstimators: estimatorId ? [estimatorId] : [],
      isActive: true,
    },
    {
      referenceNumber: "PRJ-1003",
      projectName: "Riverside Tech Campus",
      customerName: "Silicon Innovations",
      status: ProjectStatus.READY_FOR_ESTIMATOR,
      projectType: ProjectType.NEW_ESTIMATE,
      jobAddress: "789 River Rd, Austin, TX",
      assignedEstimators: [],
      isActive: true,
    },
    {
      referenceNumber: "PRJ-1004",
      projectName: "Oakwood Residential Complex",
      customerName: "Oakwood Dev Group",
      status: ProjectStatus.ESTIMATOR_FINAL,
      projectType: ProjectType.NEW_ESTIMATE,
      jobAddress: "321 Oak Ln, Denver, CO",
      assignedEstimators: estimatorId ? [estimatorId] : [],
      isActive: true,
    },
    {
      referenceNumber: "PRJ-1005",
      projectName: "Central Station Glass Overhaul",
      customerName: "Metro Transit Auth",
      status: ProjectStatus.ADMIN_PACKAGING,
      projectType: ProjectType.VARIATION,
      jobAddress: "555 Transit Blvd, Chicago, IL",
      assignedEstimators: [],
      isActive: false,
    },
  ];

  // Clear existing seeded projects
  await Project.deleteMany({ referenceNumber: { $in: projects.map((p) => p.referenceNumber) } });

  // Insert new projects
  for (const p of projects) {
    await Project.create(p);
    console.log(`✅ Seeded project: ${p.referenceNumber} - ${p.projectName}`);
  }

  console.log("\n🎉 Projects seeded successfully!\n");

  await mongoose.disconnect();
  console.log("✅ MongoDB disconnected");
  process.exit(0);
}

main().catch(async (error) => {
  console.error("❌ Seed failed:", error);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
