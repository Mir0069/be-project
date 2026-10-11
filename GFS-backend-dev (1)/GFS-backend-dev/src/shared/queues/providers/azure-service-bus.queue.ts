import { StatusCodes } from 'http-status-codes';
import { AppError } from '@shared/errors/app.error';
import type { IQueueAdapter, IQueuePublishOptions } from '../queue.types';

interface IServiceBusSender {
  sendMessages(message: { body: unknown; messageId?: string }): Promise<void>;
  close(): Promise<void>;
}

interface IServiceBusReceiver {
  subscribe(handlers: {
    processMessage: (message: { body: unknown }) => Promise<void>;
    processError: (args: { error: unknown }) => Promise<void>;
  }): void;
  close(): Promise<void>;
}

interface IServiceBusClient {
  createSender(queueName: string): IServiceBusSender;
  createReceiver(queueName: string): IServiceBusReceiver;
  close(): Promise<void>;
}

type ServiceBusClientCtor = new (connectionString: string) => IServiceBusClient;

interface IAzureServiceBusModule {
  ServiceBusClient: ServiceBusClientCtor;
}

export class AzureServiceBusQueueAdapter<TPayload> implements IQueueAdapter<TPayload> {
  private readonly client: IServiceBusClient;
  private readonly sender: IServiceBusSender;
  private receiver?: IServiceBusReceiver;
  private readonly queueName: string;

  public constructor(
    queueName: string,
    connectionString: string,
    module?: IAzureServiceBusModule,
  ) {
    this.queueName = queueName;
    const serviceBusModule = module ?? this.loadAzureServiceBusModule();
    const ClientCtor = serviceBusModule.ServiceBusClient;
    this.client = new ClientCtor(connectionString);
    this.sender = this.client.createSender(queueName);
  }

  public async publish(payload: TPayload, options?: IQueuePublishOptions): Promise<void> {
    await this.sender.sendMessages({
      body: payload,
      messageId: options?.deduplicationKey,
    });
  }

  public async subscribe(handler: (payload: TPayload) => Promise<void>): Promise<void> {
    this.receiver = this.client.createReceiver(this.queueName);
    this.receiver.subscribe({
      processMessage: async (message) => handler(message.body as TPayload),
      processError: async () => Promise.resolve(),
    });
  }

  public async close(): Promise<void> {
    await this.receiver?.close();
    await this.sender.close();
    await this.client.close();
  }

  private loadAzureServiceBusModule(): IAzureServiceBusModule {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return require('@azure/service-bus') as IAzureServiceBusModule;
    } catch {
      throw new AppError(
        '@azure/service-bus is not installed. Install it for QUEUE_PROVIDER=azure_service_bus.',
        StatusCodes.SERVICE_UNAVAILABLE,
      );
    }
  }
}
