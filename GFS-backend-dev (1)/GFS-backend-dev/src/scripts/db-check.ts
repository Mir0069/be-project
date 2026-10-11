import mongoose from 'mongoose';

import { connectDB } from '@db/connection';

(async () => {
  try {
    console.log('connecting to Cosmos…');
    await connectDB();
    console.log('✓ connected. db =', mongoose.connection.name, '| host =', mongoose.connection.host);
    const cols = await mongoose.connection.db!.listCollections().toArray();
    console.log('✓ collections:', cols.map((c) => c.name).join(', ') || '(none yet)');
    await mongoose.disconnect();
    process.exit(0);
  } catch (e) {
    console.error('✗ connect failed:', e instanceof Error ? e.message : e);
    process.exit(1);
  }
})();
