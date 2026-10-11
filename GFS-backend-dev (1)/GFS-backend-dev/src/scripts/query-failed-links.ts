import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import { CloudLinkAsset } from '@db/models/cloud-link-asset.model';
import { connectDB } from '@db/connection';

async function main() {
  await connectDB();
  
  const assets = await CloudLinkAsset.find({ provider: 'DROPBOX' })
    .sort({ createdAt: -1 })
    .limit(10)
    .lean();
    
  console.log(`Found ${assets.length} Dropbox link assets:\n`);
  for (const a of assets) {
    console.log(`Subject: "${a.subject}"`);
    console.log(`Sender: ${a.sender}`);
    console.log(`Url: ${a.originalUrl}`);
    console.log(`Status: ${a.status}`);
    console.log(`Error: ${a.errorMessage || 'No error message stored'}`);
    console.log('--------------------------------------------------');
  }
  
  await mongoose.disconnect();
}

main().catch(console.error);
