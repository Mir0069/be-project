import { env } from '@config/index';
import { createQueueAdapter } from '@shared/queues/queue.factory';
import type { IQueueAdapter } from '@shared/queues/queue.types';

import type { CrmContextPayload, ICrmContextQueuePublisher } from '../crm-context.port';

/**
 * Publishes CRM-context snapshots to the same `ai-stage-trigger` queue that
 * already carries BEGIN_EXTRACTION. The consumer discriminates on `trigger`.
 */
export class CrmContextPublisher implements ICrmContextQueuePublisher {
  private adapter: IQueueAdapter<CrmContextPayload> | null = null;

  /**
   * Built on first publish, not at construction. The Zoho router wires this at
   * import time, and createQueueAdapter throws when the queue provider is not
   * configured — a misconfigured queue must not take the whole app down at boot.
   */
  private getAdapter(): IQueueAdapter<CrmContextPayload> {
    this.adapter ??= createQueueAdapter<CrmContextPayload>(env.azure.extractionStageQueueName);
    return this.adapter;
  }

  public async publish(payload: CrmContextPayload, deduplicationKey: string): Promise<void> {
    await this.getAdapter().publish(payload, { deduplicationKey });
    console.log(
      `\n[zoho-crm-context] published to ${env.azure.extractionStageQueueName} (dedup ${deduplicationKey}):`,
    );
    console.log(JSON.stringify(payload, null, 2));
  }
}
