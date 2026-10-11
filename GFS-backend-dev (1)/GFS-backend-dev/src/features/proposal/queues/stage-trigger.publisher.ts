import { createQueueAdapter } from '@shared/queues/queue.factory';
import { env } from '@config/index';
import type { PipelineTriggerPayload, ExtractionTriggerPayload } from '../pipeline-triggers';

export interface IStageTriggerPublisher {
  publish(payload: PipelineTriggerPayload): Promise<void>;
  publishExtraction(payload: ExtractionTriggerPayload): Promise<void>;
}

export class StageTriggerPublisher implements IStageTriggerPublisher {
  // Used for Stage 0 (Initial Extraction)
  private readonly stageTriggerAdapter = createQueueAdapter<any>(
    env.azure.extractionStageQueueName,
  );

  // Used for Stages 1-6 (Pipeline progression)
  private readonly resultTriggerAdapter = createQueueAdapter<any>(
    env.azure.extractionResultQueueName,
  );

  public async publish(payload: PipelineTriggerPayload): Promise<void> {
    // MD §3: AI normalizes targetStage "EXCEL" → 6, but backend never sends
    // "EXCEL" — always the integer. Coerce defensively so a stray "EXCEL"
    // can never reach the wire and crash/misroute an older AI worker.
    const normalized = payload.targetStage === 'EXCEL'
      ? { ...payload, targetStage: 6 as const }
      : payload;
    console.log(`\n🚀 [StageTriggerPublisher] Publishing message to Azure Service Bus Queue: [${env.azure.extractionResultQueueName}] (Stages 1-6):`);
    console.log(JSON.stringify(normalized, null, 2));
    await this.resultTriggerAdapter.publish(normalized, {
      // Service Bus dedup: requires "Duplicate Detection" enabled on the
      // queue in Azure with a matching detection window (recommend >= 10
      // minutes to safely cover retries/reconnects).
      deduplicationKey: normalized.idempotencyKey,
    });
  }

  // --- NEW: Publish Extraction ---
  public async publishExtraction(payload: ExtractionTriggerPayload): Promise<void> {
    console.log(`\n🚀 [StageTriggerPublisher] Publishing extraction message to Azure Service Bus Queue: [${env.azure.extractionStageQueueName}] (Stage 0):`);
    console.log(JSON.stringify(payload, null, 2));
    await this.stageTriggerAdapter.publish(payload, {
      // Correlation ID is a safe deduplication key for the initial extraction
      deduplicationKey: `extract:${payload.correlationId}`, 
    });
  }
}

