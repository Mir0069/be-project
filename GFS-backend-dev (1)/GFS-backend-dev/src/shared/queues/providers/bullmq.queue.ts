import { AppError } from '@shared/errors/app.error';
import { StatusCodes } from 'http-status-codes';
import type { IQueueAdapter, IQueuePublishOptions } from '../queue.types';

interface IBullMqJob<TPayload> {
  data: TPayload;
}

interface IBullMqQueue<TPayload> {
  add(
    name: string,
    payload: TPayload,
    options?: {
      jobId?: string;
      attempts?: number;
      backoff?: { type: 'fixed'; delay: number };
      removeOnComplete?: boolean;
      removeOnFail?: boolean;
    },
  ): Promise<void>;
  close(): Promise<void>;
}

interface IBullMqWorker {
  close(): Promise<void>;
}

type BullMqQueueCtor = new (
  queueName: string,
  options: { connection: { url: string } },
) => IBullMqQueue<unknown>;

type BullMqWorkerCtor = new (
  queueName: string,
  processor: (job: IBullMqJob<unknown>) => Promise<void>,
  options: { connection: { url: string }; concurrency?: number },
) => IBullMqWorker;

interface IBullMqModule {
  Queue: BullMqQueueCtor;
  Worker: BullMqWorkerCtor;
}

export class BullMqQueueAdapter<TPayload> implements IQueueAdapter<TPayload> {
  private readonly queueName: string;
  private readonly redisUrl: string;
  private readonly bullMq: IBullMqModule;
  private readonly queue: IBullMqQueue<TPayload>;
  private worker?: IBullMqWorker;

  public constructor(queueName: string, redisUrl: string, bullMqModule?: IBullMqModule) {
    this.queueName = queueName;
    this.redisUrl = redisUrl;
    this.bullMq = bullMqModule ?? this.loadBullMqModule();
    this.queue = new this.bullMq.Queue(this.queueName, {
      connection: { url: this.redisUrl },
    }) as IBullMqQueue<TPayload>;
  }

  public async publish(payload: TPayload, options?: IQueuePublishOptions): Promise<void> {
    await this.queue.add(this.queueName, payload, {
      jobId: options?.deduplicationKey,
      attempts: options?.attempts,
      backoff:
        typeof options?.backoffMs === 'number'
          ? { type: 'fixed', delay: options.backoffMs }
          : undefined,
      removeOnComplete: true,
      removeOnFail: false,
    });
  }

  public async subscribe(handler: (payload: TPayload) => Promise<void>): Promise<void> {
    // Optimization: Enable concurrency for parallel job processing (3 concurrent jobs per worker).
    // This allows handling multiple documents in parallel while respecting rate limits.
    this.worker = new this.bullMq.Worker(
      this.queueName,
      async (job) => handler(job.data as TPayload),
      {
        connection: { url: this.redisUrl },
        concurrency: 3, // Process up to 3 jobs concurrently; rate limiter enforces Azure RPS limits
      },
    );
  }

  public async close(): Promise<void> {
    await this.worker?.close();
    await this.queue.close();
  }

  private loadBullMqModule(): IBullMqModule {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return require('bullmq') as IBullMqModule;
    } catch {
      throw new AppError(
        'BullMQ is not installed. Install bullmq to use QUEUE_PROVIDER=bullmq.',
        StatusCodes.SERVICE_UNAVAILABLE,
      );
    }
  }
}
