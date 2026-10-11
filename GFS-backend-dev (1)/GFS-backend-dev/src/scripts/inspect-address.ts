import mongoose from 'mongoose';

import { connectDB } from '@db/connection';
import { OutlookEmail } from '@db/models/outlook-email.model';
import { Project } from '@db/models/project.model';
import { ZohoLead } from '@db/models/zoho-lead.model';

/** Read-only: dump what the AI returned + what we stored for a mail-first project. */
const main = async (): Promise<void> => {
  await connectDB();
  const subject = process.argv[2] || '91 robinson';

  const email = await OutlookEmail.findOne({ subject: { $regex: subject, $options: 'i' } })
    .sort({ createdAt: -1 })
    .lean();

  if (!email) { console.log(`no email matching "${subject}"`); await mongoose.disconnect(); process.exit(0); }

  console.log('=== EMAIL.proposed (what the AI returned) ===');
  const p: any = email.proposed || {};
  console.log(`  customerName: ${p.customerName}`);
  console.log(`  projectName : ${p.projectName}`);
  console.log(`  address     : ${p.address ?? '(none)'}`);
  console.log(`  jobAddress  : ${p.jobAddress ?? '(none)'}`);
  console.log(`  bodyText    : ${(email.bodyText || '').replace(/\s+/g, ' ').slice(0, 200)}`);

  if (email.projectId) {
    const project: any = await Project.findById(String(email.projectId)).lean();
    console.log('\n=== PROJECT (what we stored) ===');
    console.log(`  projectName: ${project?.projectName}`);
    console.log(`  jobAddress : ${project?.jobAddress ?? '(none)'}`);
    console.log(`  address    : ${JSON.stringify(project?.address)}`);
    if (project?.zohoLeadId) {
      const lead: any = await ZohoLead.findOne({ zohoLeadId: project.zohoLeadId }).lean();
      console.log('\n=== ZOHO LEAD (mapped from Zoho) ===');
      console.log(`  street : ${lead?.street ?? '(none)'}`);
      console.log(`  city   : ${lead?.city ?? '(none)'}`);
      console.log(`  state  : ${lead?.state ?? '(none)'}`);
      console.log(`  zipCode: ${lead?.zipCode ?? '(none)'}`);
      console.log(`  country: ${lead?.country ?? '(none)'}`);
      console.log(`  raw.Street/City/State/Zip/Country: ${JSON.stringify({
        Street: lead?.raw?.Street, City: lead?.raw?.City, State: lead?.raw?.State,
        Zip_Code: lead?.raw?.Zip_Code, Country: lead?.raw?.Country,
      })}`);
    }
  }

  await mongoose.disconnect();
  process.exit(0);
};

main().catch((e) => { console.error(e); process.exit(1); });
