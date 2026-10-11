import { env } from '@config/index';
import { AppError } from '@shared/errors/app.error';
import { StatusCodes } from 'http-status-codes';
import { AzureServiceBusQueueAdapter } from './providers/azure-service-bus.queue';
import { BullMqQueueAdapter } from './providers/bullmq.queue';
import { InMemoryQueueAdapter } from './providers/in-memory.queue';
import type { IQueueAdapter, QueueProvider } from './queue.types';

export const createQueueAdapter = <TPayload>(
  queueName: string,
  provider = env.queue.provider as QueueProvider,
): IQueueAdapter<TPayload> => {
  switch (provider) {
    case 'in_memory':
      if (env.app.nodeEnv === 'production') {
        throw new AppError(
          'QUEUE_PROVIDER=in_memory is not supported in production. Use bullmq or azure_service_bus.',
          StatusCodes.INTERNAL_SERVER_ERROR,
        );
      }
      return new InMemoryQueueAdapter<TPayload>();
    case 'bullmq':
      return new BullMqQueueAdapter<TPayload>(queueName, env.queue.bullmqRedisUrl);
    case 'azure_service_bus': {
      if (!env.queue.azureServiceBusConnectionString) {
        throw new AppError(
          'AZURE_SERVICE_BUS_CONNECTION_STRING is required for QUEUE_PROVIDER=azure_service_bus',
          StatusCodes.INTERNAL_SERVER_ERROR,
        );
      }

      return new AzureServiceBusQueueAdapter<TPayload>(
        queueName,
        env.queue.azureServiceBusConnectionString,
      );
    }
    default:
      throw new AppError(
        `Unsupported queue provider: ${provider}`,
        StatusCodes.INTERNAL_SERVER_ERROR,
      );
  }
};
