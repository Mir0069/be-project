import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';

/**
 * One-off: copy the Zoho OAuth token from the `test` database (where it was
 * accidentally written when the URI had no db name) into `gfs`, so the app can
 * authenticate to Zoho after we pin the URI to /gfs — no re-OAuth needed.
 */
const main = async (): Promise<void> => {
  const uri = process.env['MONGODB_URI'];
  if (!uri) throw new Error('MONGODB_URI not set');
  await mongoose.connect(uri);

  const client = mongoose.connection.getClient();
  const src = client.db('test').collection('zohotokens');
  const dst = client.db('gfs').collection('zohotokens');

  const tokens = await src.find().toArray();
  console.log(`Found ${tokens.length} token(s) in test.zohotokens`);

  for (const t of tokens) {
    const { _id, ...rest } = t;
    void _id;
    await dst.updateOne({ accountKey: rest['accountKey'] }, { $set: rest }, { upsert: true });
    console.log(`Copied token accountKey="${rest['accountKey']}" -> gfs.zohotokens`);
  }

  const finalCount = await dst.countDocuments();
  console.log(`gfs.zohotokens now has ${finalCount} token(s)`);

  await mongoose.disconnect();
  process.exit(0);
};

main().catch((err) => {
  console.error('copy-token failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
