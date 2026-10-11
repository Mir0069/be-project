/**
 * =============================================================================
 * OPS SCRIPT — Drain and log AI Stage Trigger DLQ
 * =============================================================================
 * Reads from the ai-stage-trigger-dlq queue, logs the dead-lettered messages,
 * and optionally can replay them. For now, it just logs and clears them.
 * 
 * Usage:
 *   npx ts-node --require tsconfig-paths/register src/scripts/drain-stage-trigger-dlq.ts
 * =============================================================================
 */

import * as dotenv from 'dotenv';
import path from 'path';

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { env } from '../config/index';
import { ServiceBusClient } from '@azure/service-bus';

async function drainDlq() {
  const connectionString = env.queue.azureServiceBusConnectionString;
  if (!connectionString) {
    console.log('No AZURE_SERVICE_BUS_CONNECTION_STRING provided. Skipping.');
    process.exit(0);
  }

  const sbClient = new ServiceBusClient(connectionString);
  const queueName = env.azure.extractionStageDlqName;
  
  // The DLQ is accessed by appending /$DeadLetterQueue to the queue name
  const receiver = sbClient.createReceiver(queueName, { subQueueType: "deadLetter" });

  console.log(`🔌 Connecting to DLQ: ${queueName}/$DeadLetterQueue`);
  
  let drainedCount = 0;
  
  try {
    const messages = await receiver.receiveMessages(10, { maxWaitTimeInMs: 5000 });
    
    if (messages.length === 0) {
      console.log('✅ DLQ is empty.');
    } else {
      for (const msg of messages) {
        console.log(`[DLQ MESSAGE] ID: ${msg.messageId}`);
        console.log(JSON.stringify(msg.body, null, 2));
        // Acknowledge the message to remove it from the DLQ
        await receiver.completeMessage(msg);
        drainedCount++;
      }
      console.log(`✅ Drained ${drainedCount} messages from DLQ.`);
    }
  } catch (error) {
    console.error('❌ Error draining DLQ:', error);
  } finally {
    await receiver.close();
    await sbClient.close();
  }
}

drainDlq()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Script failed:', err);
    process.exit(1);
  });
