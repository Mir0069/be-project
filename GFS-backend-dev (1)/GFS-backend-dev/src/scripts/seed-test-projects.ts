import mongoose from 'mongoose';

import { connectDB } from '@db/connection';
import { projectRepository } from '@repositories/index';
import { ProjectType } from '@db/models/project.model';

// Reference numbers that appear in the gfs2 test emails, so a fresh email
// mentioning one of these auto-links (linkMethod = AUTO).
const SEED = [
  { referenceNumber: 'PRJ-1045', projectName: 'Office Renovation Q3', customerName: 'Acme Corp' },
  { referenceNumber: 'PRJ-1113', projectName: 'Website Redesign Project', customerName: 'Globex' },
];

const main = async (): Promise<void> => {
  await connectDB();
  for (const s of SEED) {
    const existing = await projectRepository.findByReferenceNumber(s.referenceNumber);
    if (existing) {
      console.log(`= already exists: ${s.referenceNumber} (${existing.id})`);
      continue;
    }
    const created = await projectRepository.create({
      referenceNumber: s.referenceNumber,
      projectName: s.projectName,
      customerName: s.customerName,
      projectType: ProjectType.NEW_ESTIMATE,
    });
    console.log(`+ created: ${created.referenceNumber} — ${created.projectName} (${created.id})`);
  }
  await mongoose.disconnect();
  process.exit(0);
};

main().catch((err) => {
  console.error('seed failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
