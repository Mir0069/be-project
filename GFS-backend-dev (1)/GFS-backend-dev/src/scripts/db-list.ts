import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';

const main = async (): Promise<void> => {
  const uri = process.env['MONGODB_URI'];
  if (!uri) throw new Error('MONGODB_URI not set');

  await mongoose.connect(uri);
  const admin = mongoose.connection.db!.admin();
  const { databases } = await admin.listDatabases();

  console.log(`Connected. Default DB mongoose picked: "${mongoose.connection.name}"\n`);
  console.log('Databases on this cluster:');
  for (const d of databases) {
    console.log(`  - ${d.name}`);
  }

  // For each candidate db, count the zoho collections via the native driver.
  const client = mongoose.connection.getClient();
  for (const name of databases.map((d) => d.name).filter((n) => !['admin', 'local', 'config'].includes(n))) {
    try {
      const db = client.db(name);
      const cols = (await db.listCollections().toArray()).map((c) => c.name);
      const count = async (c: string): Promise<number | string> =>
        cols.includes(c) ? db.collection(c).countDocuments() : '—';
      console.log(`\n[${name}] ${cols.length} collections`);
      console.log(`   zoholeads=${await count('zoholeads')}  zoholeadchanges=${await count('zoholeadchanges')}  users=${await count('users')}  zohotokens=${await count('zohotokens')}  projects=${await count('projects')}`);
    } catch (e) {
      console.log(`\n[${name}] error: ${e instanceof Error ? e.message : e}`);
    }
  }

  await mongoose.disconnect();
  process.exit(0);
};

main().catch((err) => {
  console.error('db-list failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
