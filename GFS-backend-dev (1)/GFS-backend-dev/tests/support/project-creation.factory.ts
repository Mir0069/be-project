import { ProjectCreationService } from '@features/project-creation/project-creation.service';
import { MongooseProjectRepository } from '@repositories/mongoose/project.repository';
import { MongooseSequenceRepository } from '@repositories/mongoose/sequence.repository';
import { MongooseProjectParameterRepository } from '@repositories/mongoose/project-parameter.repository';
import type { IFileStorageRepository } from '@repositories/interfaces/i-file-storage.repository';

export class FakeFileStorage implements IFileStorageRepository {
  public async uploadFile(_fileName: string, _fileBuffer: Buffer, _mimeType: string): Promise<string> {
    return 'fake://uploaded';
  }

  public async getDownloadUrl(_fileName: string): Promise<string> {
    return 'fake://download';
  }

  public async deleteFile(_fileName: string): Promise<void> {
    return;
  }

  public async createFolderStructure(_basePath: string, _folders: string[]): Promise<void> {
    return;
  }

  public getProjectRootPath(projectId: string): string {
    return `projects/${projectId}`;
  }
}

export const buildProjectCreation = () => {
  const projectRepository = new MongooseProjectRepository();
  const projectCreationService = new ProjectCreationService(
    projectRepository,
    new MongooseSequenceRepository(),
    new FakeFileStorage(),
    new MongooseProjectParameterRepository(),
  );
  return { projectRepository, projectCreationService };
};
