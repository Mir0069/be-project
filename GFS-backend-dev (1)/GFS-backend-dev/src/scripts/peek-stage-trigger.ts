import * as dotenv from 'dotenv';
import path from 'path';

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { env } from '../config/index';
import { ServiceBusClient } from '@azure/service-bus';

async function peekQueue() {
  const connectionString = env.queue.azureServiceBusConnectionString;
  if (!connectionString) {
    console.log('No AZURE_SERVICE_BUS_CONNECTION_STRING provided. Skipping.');
    process.exit(0);
  }

  const sbClient = new ServiceBusClient(connectionString);
  const queueName = env.azure.extractionStageQueueName; // We are reusing this as per prompt for ai-stage-trigger
  
  const receiver = sbClient.createReceiver(queueName);

  console.log(`🔌 Connected to Queue: ${queueName}`);
  console.log(`👀 Peeking at up to 10 messages (this does NOT remove them from the queue)...`);
  
  try {
    const messages = await receiver.peekMessages(10);
    
    if (messages.length === 0) {
      console.log('✅ Queue is currently empty.');
    } else {
      messages.forEach((msg, idx) => {
        console.log(`\n--- [MESSAGE ${idx + 1}] ---`);
        console.log(`Message ID:`, msg.messageId);
        console.log(`Enqueued Time:`, msg.enqueuedTimeUtc);
        console.log(`Body:`, JSON.stringify(msg.body, null, 2));
      });
      console.log(`\n✅ Peeked at ${messages.length} messages.`);
    }
  } catch (error) {
    console.error('❌ Error peeking at queue:', error);
  } finally {
    await receiver.close();
    await sbClient.close();
  }
}

peekQueue()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Script failed:', err);
    process.exit(1);
  });
