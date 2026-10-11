export interface IQueueAdapter<TPayload> {
  publish(payload: TPayload, options?: IQueuePublishOptions): Promise<void>;
  subscribe(handler: (payload: TPayload) => Promise<void>): Promise<void>;
  close(): Promise<void>;
}

export interface IQueuePublishOptions {
  deduplicationKey?: string;
  attempts?: number;
  backoffMs?: number;
}

export type QueueProvider = 'in_memory' | 'bullmq' | 'azure_service_bus';
