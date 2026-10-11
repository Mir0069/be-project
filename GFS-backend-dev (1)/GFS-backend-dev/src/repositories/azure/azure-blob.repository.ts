import { BlobServiceClient, ContainerClient } from '@azure/storage-blob';
import { IFileStorageRepository } from '../interfaces/i-file-storage.repository';
import { AppError } from '@shared/errors/app.error';

export class AzureBlobRepository implements IFileStorageRepository {
  private containerClient: ContainerClient;

  constructor() {
const connectionString = process.env['AZURE_STORAGE_CONNECTION_STRING'];
const containerName = process.env['AZURE_STORAGE_CONTAINER_NAME'];

    if (!connectionString) {
      throw new AppError('AZURE_STORAGE_CONNECTION_STRING environment variable is missing', 500);
    }
    if (!containerName) {
      throw new AppError('AZURE_STORAGE_CONTAINER_NAME environment variable is missing', 500);
    }

    try {
      const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
      this.containerClient = blobServiceClient.getContainerClient(containerName);
    } catch (error: any) {
      throw new AppError(`Failed to initialize Azure Blob Client: ${error.message}`, 500);
    }
  }

  async uploadFile(_fileName: string, _fileBuffer: Buffer, _mimeType: string): Promise<string> {
    throw new Error('Method not implemented.');
  }

  async getDownloadUrl(_fileName: string): Promise<string> {
    throw new Error('Method not implemented.');
  }

  async deleteFile(_fileName: string): Promise<void> {
    throw new Error('Method not implemented.');
  }

  getProjectRootPath(projectId: string): string {
    return `projects/${projectId}`;
  }

  async createFolderStructure(basePath: string, folders: string[]): Promise<void> {
    try {
      // Ensure the basePath ends with a slash
      const normalizedBasePath = basePath.endsWith('/') ? basePath : `${basePath}/`;

      const uploadPromises = folders.map((folder) => {
        // Strip leading/trailing slashes from folder name
        const normalizedFolder = folder.replace(/^\/+|\/+$/g, '');
        const blobName = `${normalizedBasePath}${normalizedFolder}/.keep`;
        
        const blockBlobClient = this.containerClient.getBlockBlobClient(blobName);
        
        // Upload a zero-byte payload to create the virtual folder
        return blockBlobClient.upload("", 0);
      });

      await Promise.all(uploadPromises);
    } catch (error: any) {
      throw new AppError(`Failed to create Azure folder structure: ${error.message}`, 500);
    }
  }
}
