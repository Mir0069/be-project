export interface IFileStorageRepository {
  uploadFile(fileName: string, fileBuffer: Buffer, mimeType: string): Promise<string>;
  getDownloadUrl(fileName: string): Promise<string>;
  deleteFile(fileName: string): Promise<void>;
  
  /**
   * Creates a set of standard folders for a given base path.
   */
  createFolderStructure(basePath: string, folders: string[]): Promise<void>;

  /**
   * Generates the standard project root path prefix
   * @param projectId The project ID
   */
  getProjectRootPath(projectId: string): string;
}
