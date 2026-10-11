import { MongooseDocumentRepository } from '../../../../src/repositories/mongoose/document.repository';
import { DocumentModel, DocumentTypeTag } from '../../../../src/db/models/document.model';

jest.mock('../../../../src/db/models/document.model', () => ({
  DocumentModel: {
    find: jest.fn(),
  },
  DocumentTypeTag: {
    DRAWING: 'drawing',
    SPEC: 'spec',
    TRANSCRIPT: 'transcript',
    QUOTE: 'quote',
    PHOTO: 'photo',
    OTHER: 'other',
    GENERAL: 'GENERAL',
  },
}));

describe('MongooseDocumentRepository.listByProject', () => {
  let repository: MongooseDocumentRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repository = new MongooseDocumentRepository();
  });

  it('filters out quote documents and proposal generator files from customer documents list', async () => {
    const mockFind = jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue([]),
      }),
    });
    (DocumentModel.find as jest.Mock).mockImplementation(mockFind);

    await repository.listByProject('507f1f77bcf86cd799439011');

    expect(DocumentModel.find).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: '507f1f77bcf86cd799439011',
        isInternal: { $ne: true },
        documentType: { $ne: DocumentTypeTag.QUOTE },
        'metadata.source': { $ne: 'proposal-generator' },
        'metadata.isEmailBody': { $ne: true },
      })
    );
  });
});
