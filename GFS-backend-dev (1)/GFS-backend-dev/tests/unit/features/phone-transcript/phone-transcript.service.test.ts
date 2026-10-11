import mongoose from 'mongoose';
import { AppError } from '@shared/errors/app.error';
import { AiExtractionStatus } from '@db/models/call-record.model';
import { PhoneTranscriptService } from '@features/phone-transcript/phone-transcript.service';
import type { ICallRecordRepository, IDomainCallRecord } from '@repositories/interfaces/i-call-record.repository';
import type { IProjectRepository, IDomainProject } from '@repositories/interfaces/i-project.repository';
import type { ProjectStatus, ProjectType, ProjectCreationSource } from '@db/models/project.model';

// ─── Factories ────────────────────────────────────────────────────────────────

const makeProject = (overrides?: Partial<IDomainProject>): IDomainProject => ({
  id: new mongoose.Types.ObjectId().toString(),
  referenceNumber: 'GFS-001',
  projectName: 'Test Project',
  customerName: 'Acme Corp',
  status: 'SETUP_PENDING' as ProjectStatus,
  projectType: 'NEW_ESTIMATE' as ProjectType,
  creationSource: 'ZOHO_FIRST' as ProjectCreationSource,
  identifierHash: null,
  zohoLeadId: null,
  jobAddress: null,
  quoteNumber: null,
  leadStatus: null,
  blobStorageURL: null,
  dropboxFolderPath: null,
  customerEmail: null,
  customerPhone: null,
  company: null,
  customerWebsite: null,
  description: null,
  receivedDate: null,
  address: null,
  assignedEstimators: [],
  lastZohoSyncedAt: null,
  estimatedCost: null,
  totalSqFt: null,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const makeCallRecord = (overrides?: Partial<IDomainCallRecord>): IDomainCallRecord => ({
  id: new mongoose.Types.ObjectId().toString(),
  projectId: new mongoose.Types.ObjectId().toString(),
  callDate: new Date('2026-05-01'),
  customerName: 'Acme Corp',
  summaryText: 'Customer requested 10m x 6m glass enclosure with thermal break.',
  contributedBy: new mongoose.Types.ObjectId().toString(),
  aiExtractionStatus: AiExtractionStatus.NOT_REQUESTED,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockCallRecordRepo = (): jest.Mocked<ICallRecordRepository> => ({
  findById: jest.fn(),
  findByProjectId: jest.fn(),
  create: jest.fn(),
  updateById: jest.fn(),
  deleteById: jest.fn(),
});

const mockProjectRepo = (): jest.Mocked<IProjectRepository> => ({
  findById: jest.fn(),
  findByReferenceNumber: jest.fn(),
  findByZohoLeadId: jest.fn(),
  listActive: jest.fn(),
  create: jest.fn(),
  updateById: jest.fn(),
  deleteById: jest.fn(),
});

// ─── Setup ────────────────────────────────────────────────────────────────────

let callRecordRepo: jest.Mocked<ICallRecordRepository>;
let projectRepo: jest.Mocked<IProjectRepository>;
let service: PhoneTranscriptService;

beforeEach(() => {
  callRecordRepo = mockCallRecordRepo();
  projectRepo = mockProjectRepo();
  service = new PhoneTranscriptService(callRecordRepo, projectRepo, {} as any);
});

// ─── createCallRecord ─────────────────────────────────────────────────────────

describe('PhoneTranscriptService — createCallRecord', () => {
  it('creates a call record when project exists', async () => {
    const project = makeProject();
    const record = makeCallRecord({ projectId: project.id });

    projectRepo.findById.mockResolvedValueOnce(project);
    callRecordRepo.create.mockResolvedValueOnce(record);

    const result = await service.createCallRecord(
      project.id,
      { callDate: new Date(), customerName: 'Acme Corp', summaryText: 'Test summary' },
      record.contributedBy!,
    );

    expect(result).toEqual(record);
    expect(callRecordRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: project.id, customerName: 'Acme Corp' }),
    );
  });

  it('throws 404 when project does not exist', async () => {
    projectRepo.findById.mockResolvedValueOnce(null);

    await expect(
      service.createCallRecord(
        new mongoose.Types.ObjectId().toString(),
        { callDate: new Date(), customerName: 'Test', summaryText: 'Summary' },
        new mongoose.Types.ObjectId().toString(),
      ),
    ).rejects.toThrow(new AppError('Project not found', 404));
  });

  it('throws 404 when project is inactive', async () => {
    projectRepo.findById.mockResolvedValueOnce(makeProject({ isActive: false }));

    await expect(
      service.createCallRecord(
        new mongoose.Types.ObjectId().toString(),
        { callDate: new Date(), customerName: 'Test', summaryText: 'Summary' },
        new mongoose.Types.ObjectId().toString(),
      ),
    ).rejects.toThrow(new AppError('Project not found', 404));
  });
});

// ─── listCallRecords ──────────────────────────────────────────────────────────

describe('PhoneTranscriptService — listCallRecords', () => {
  it('returns paginated call records for a project', async () => {
    const project = makeProject();
    const records = [makeCallRecord({ projectId: project.id }), makeCallRecord({ projectId: project.id })];

    projectRepo.findById.mockResolvedValueOnce(project);
    callRecordRepo.findByProjectId.mockResolvedValueOnce({ records, total: 2 });

    const result = await service.listCallRecords(project.id, { page: 1, limit: 12 });

    expect(result.records).toHaveLength(2);
    expect(result.total).toBe(2);
    expect(callRecordRepo.findByProjectId).toHaveBeenCalledWith(project.id, 1, 12);
  });

  it('throws 404 when project does not exist', async () => {
    projectRepo.findById.mockResolvedValueOnce(null);

    await expect(
      service.listCallRecords(new mongoose.Types.ObjectId().toString(), { page: 1, limit: 12 }),
    ).rejects.toThrow(new AppError('Project not found', 404));
  });
});

// ─── getCallRecord ────────────────────────────────────────────────────────────

describe('PhoneTranscriptService — getCallRecord', () => {
  it('returns the call record when it belongs to the project', async () => {
    const record = makeCallRecord();
    callRecordRepo.findById.mockResolvedValueOnce(record);

    const result = await service.getCallRecord(record.projectId, record.id);

    expect(result).toEqual(record);
  });

  it('throws 404 when record does not exist', async () => {
    callRecordRepo.findById.mockResolvedValueOnce(null);

    await expect(
      service.getCallRecord(
        new mongoose.Types.ObjectId().toString(),
        new mongoose.Types.ObjectId().toString(),
      ),
    ).rejects.toThrow(new AppError('Call record not found', 404));
  });

  it('throws 404 when record belongs to a different project', async () => {
    const record = makeCallRecord({ projectId: new mongoose.Types.ObjectId().toString() });
    callRecordRepo.findById.mockResolvedValueOnce(record);

    await expect(
      service.getCallRecord(new mongoose.Types.ObjectId().toString(), record.id),
    ).rejects.toThrow(new AppError('Call record not found', 404));
  });

  it('throws 404 when record is inactive', async () => {
    const record = makeCallRecord({ isActive: false });
    callRecordRepo.findById.mockResolvedValueOnce(record);

    await expect(
      service.getCallRecord(record.projectId, record.id),
    ).rejects.toThrow(new AppError('Call record not found', 404));
  });
});

// ─── updateCallRecord ─────────────────────────────────────────────────────────

describe('PhoneTranscriptService — updateCallRecord', () => {
  it('updates and returns the call record', async () => {
    const record = makeCallRecord();
    const updated = makeCallRecord({ ...record, customerName: 'Updated Corp' });

    callRecordRepo.findById.mockResolvedValueOnce(record);
    callRecordRepo.updateById.mockResolvedValueOnce(updated);

    const result = await service.updateCallRecord(record.projectId, record.id, {
      customerName: 'Updated Corp',
    });

    expect(result.customerName).toBe('Updated Corp');
  });

  it('throws 404 when record does not exist', async () => {
    callRecordRepo.findById.mockResolvedValueOnce(null);

    await expect(
      service.updateCallRecord(
        new mongoose.Types.ObjectId().toString(),
        new mongoose.Types.ObjectId().toString(),
        { customerName: 'New Name' },
      ),
    ).rejects.toThrow(new AppError('Call record not found', 404));
  });

  it('throws 404 when concurrent soft-delete races the update (updateById returns null)', async () => {
    const record = makeCallRecord();
    callRecordRepo.findById.mockResolvedValueOnce(record);
    callRecordRepo.updateById.mockResolvedValueOnce(null);

    await expect(
      service.updateCallRecord(record.projectId, record.id, { customerName: 'New Name' }),
    ).rejects.toThrow(new AppError('Call record not found', 404));
  });
});

// ─── deleteCallRecord ─────────────────────────────────────────────────────────

describe('PhoneTranscriptService — deleteCallRecord', () => {
  it('soft-deletes the call record and returns it', async () => {
    const record = makeCallRecord();
    const deleted = makeCallRecord({ ...record, isActive: false });

    callRecordRepo.findById.mockResolvedValueOnce(record);
    callRecordRepo.deleteById.mockResolvedValueOnce(deleted);

    const result = await service.deleteCallRecord(record.projectId, record.id);

    expect(result.isActive).toBe(false);
    expect(callRecordRepo.deleteById).toHaveBeenCalledWith(record.id);
  });

  it('throws 404 when record does not exist', async () => {
    callRecordRepo.findById.mockResolvedValueOnce(null);

    await expect(
      service.deleteCallRecord(
        new mongoose.Types.ObjectId().toString(),
        new mongoose.Types.ObjectId().toString(),
      ),
    ).rejects.toThrow(new AppError('Call record not found', 404));
  });

  it('throws 404 when concurrent double-delete races (deleteById returns null)', async () => {
    const record = makeCallRecord();
    callRecordRepo.findById.mockResolvedValueOnce(record);
    callRecordRepo.deleteById.mockResolvedValueOnce(null);

    await expect(
      service.deleteCallRecord(record.projectId, record.id),
    ).rejects.toThrow(new AppError('Call record not found', 404));
  });
});

// ─── triggerAiExtraction ──────────────────────────────────────────────────────

describe('PhoneTranscriptService — triggerAiExtraction', () => {
  it('runs extraction and returns COMPLETED record', async () => {
    const record = makeCallRecord({ summaryText: 'Customer needs 10m x 6m Series 2000 system.' });
    const pending = makeCallRecord({ ...record, aiExtractionStatus: AiExtractionStatus.PENDING });
    const completed = makeCallRecord({
      ...record,
      aiExtractionStatus: AiExtractionStatus.COMPLETED,
      aiExtractedRequirements: 'Extracted requirements...',
      aiExtractedAt: new Date(),
    });

    callRecordRepo.findById.mockResolvedValueOnce(record);
    callRecordRepo.updateById
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(completed);

    const result = await service.triggerAiExtraction(record.projectId, record.id);

    expect(result.aiExtractionStatus).toBe(AiExtractionStatus.COMPLETED);
    expect(callRecordRepo.updateById).toHaveBeenCalledTimes(2);
  });

  it('runs extraction for a transcriptFileUrl-only record (no summaryText)', async () => {
    const record = makeCallRecord({
      summaryText: undefined,
      transcriptFileUrl: 'https://storage.example.com/transcripts/call-001.txt',
    });
    const pending = makeCallRecord({ ...record, aiExtractionStatus: AiExtractionStatus.PENDING });
    const completed = makeCallRecord({
      ...record,
      aiExtractionStatus: AiExtractionStatus.COMPLETED,
      aiExtractedRequirements: '[Pending AI integration] Transcript excerpt for review: [file: https://storage.example.com/transcripts/call-001.txt]',
      aiExtractedAt: new Date(),
    });

    callRecordRepo.findById.mockResolvedValueOnce(record);
    callRecordRepo.updateById
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(completed);

    const result = await service.triggerAiExtraction(record.projectId, record.id);

    expect(result.aiExtractionStatus).toBe(AiExtractionStatus.COMPLETED);
  });

  it('throws 409 when extraction is already in progress', async () => {
    const record = makeCallRecord({ aiExtractionStatus: AiExtractionStatus.PENDING });
    callRecordRepo.findById.mockResolvedValueOnce(record);

    await expect(
      service.triggerAiExtraction(record.projectId, record.id),
    ).rejects.toThrow(new AppError('AI extraction is already in progress', 409));
  });

  it('throws 409 (not 422) when record is PENDING even if it has no text', async () => {
    const record = makeCallRecord({
      summaryText: undefined,
      transcriptFileUrl: undefined,
      aiExtractionStatus: AiExtractionStatus.PENDING,
    });
    callRecordRepo.findById.mockResolvedValueOnce(record);

    await expect(
      service.triggerAiExtraction(record.projectId, record.id),
    ).rejects.toThrow(new AppError('AI extraction is already in progress', 409));
  });

  it('throws 422 when record has no text to extract from', async () => {
    const record = makeCallRecord({ summaryText: undefined, transcriptFileUrl: undefined });
    callRecordRepo.findById.mockResolvedValueOnce(record);

    await expect(
      service.triggerAiExtraction(record.projectId, record.id),
    ).rejects.toThrow(new AppError('No transcript text available for AI extraction', 422));
  });

  it('throws 404 when record does not exist', async () => {
    callRecordRepo.findById.mockResolvedValueOnce(null);

    await expect(
      service.triggerAiExtraction(
        new mongoose.Types.ObjectId().toString(),
        new mongoose.Types.ObjectId().toString(),
      ),
    ).rejects.toThrow(new AppError('Call record not found', 404));
  });
});
