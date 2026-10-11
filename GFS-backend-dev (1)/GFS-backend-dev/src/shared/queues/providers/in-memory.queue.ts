import type { IQueueAdapter, IQueuePublishOptions } from '../queue.types';

export class InMemoryQueueAdapter<TPayload> implements IQueueAdapter<TPayload> {
  private handler?: (payload: TPayload) => Promise<void>;
  private queue: TPayload[] = [];
  private activeCount = 0;
  private readonly concurrencyLimit: number;

  public constructor(concurrencyLimit = 5) {
    this.concurrencyLimit = concurrencyLimit;
  }

  public async publish(payload: TPayload, _options?: IQueuePublishOptions): Promise<void> {
    if (!this.handler) {
      return;
    }

    this.queue.push(payload);
    this.processNext();
  }

  private processNext(): void {
    if (!this.handler || this.activeCount >= this.concurrencyLimit || this.queue.length === 0) {
      return;
    }

    const payload = this.queue.shift();
    if (!payload) return;

    this.activeCount++;
    setImmediate(() => {
      if (!this.handler) {
        this.activeCount--;
        return;
      }
      this.handler(payload)
        .catch((err) => {
          console.error('[InMemoryQueue] Unhandled error in queue handler:', err);
        })
        .finally(() => {
          this.activeCount--;
          this.processNext();
        });
    });
  }

  public async subscribe(handler: (payload: TPayload) => Promise<void>): Promise<void> {
    this.handler = handler;
    this.processNext();
  }

  public async close(): Promise<void> {
    this.handler = undefined;
    this.queue = [];
  }
}
