import mongoose from 'mongoose';
import { env } from '@config/index';

export const connectDB = async (retries = 5, delayMs = 3000): Promise<void> => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const conn = await mongoose.connect(env.db.mongoUri, {
        maxPoolSize: 50,
        minPoolSize: 10,
        serverSelectionTimeoutMS: 30000,
        socketTimeoutMS: 45000,
        connectTimeoutMS: 30000,
        maxIdleTimeMS: 30000,
        retryReads: true,
      });
      console.log(`MongoDB connected: ${conn.connection.host}`);

      mongoose.connection.on('error', (err) => {
        console.warn('[Mongoose] Connection error:', err.message);
      });
      mongoose.connection.on('disconnected', () => {
        console.warn('[Mongoose] Connection lost, reconnecting...');
      });

      return;
    } catch (err) {
      console.warn(`[DB] Connection attempt ${attempt}/${retries} failed: ${(err as Error).message}`);
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
};

export const disconnectDB = async (): Promise<void> => {
  await mongoose.disconnect();
  console.log('MongoDB disconnected');
};