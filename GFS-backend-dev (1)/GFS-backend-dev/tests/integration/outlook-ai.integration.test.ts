// outlook-ai.integration.test.ts
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { Project, ProjectStatus, ProjectCreationSource, ProjectType } from '@db/models/project.model';
import { OutlookEmail } from '@db/models/outlook-email.model';
import { DocumentModel } from '@db/models/document.model';
import { OutlookService } from '@features/outlook/outlook.service';
import { MongooseProjectRepository } from '@repositories/mongoose/project.repository';
import { proposalService } from '@features/proposal/proposal.router';
import { buildProjectCreation } from '../support/project-creation.factory';

let mongod: MongoMemoryServer;
let outlookService: OutlookService;
let projectRepository: MongooseProjectRepository;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create({
    instance: {
      // Default launchTimeout (10s) is too tight on Windows — antivirus
      // scanning the freshly-cached mongod.exe (and its killer helper
      // process) can add 10-15s before mongod even launches, causing
      // mongodb-memory-server to kill a perfectly healthy instance.
      launchTimeout: 60000,
    },
  });
  await mongoose.connect(mongod.getUri());
  await Project.syncIndexes();
}, 90000); // Jest's own hook timeout also needs raising, or IT becomes the new bottleneck

afterAll(async () => {
  await mongoose.disconnect();
  // Optional chaining guards against "Cannot read properties of undefined
  // (reading 'stop')" if beforeAll ever throws before mongod is assigned.
  await mongod?.stop();
});

beforeEach(async () => {
  await Promise.all([
    Project.deleteMany({}),
    OutlookEmail.deleteMany({}),
    DocumentModel.deleteMany({}),
  ]);

  // Reuse the same real Project machinery mail-first's tests use, so the
  // "existing project" in this test is a real, valid Project document rather
  // than a hand-rolled one that might miss required fields.
  const built = buildProjectCreation();
  projectRepository = built.projectRepository;

  // processAiResult only touches graphClient/tokenService/monitoredMailboxRepository/
  // emailRepository/associationService/documentPort/blobStorage for OTHER methods —
  // the LINK branch we're testing uses mongoose.model('OutlookEmail') directly and
  // only calls out to projectRepository (for the Dropbox-sync/notify lookup) and
  // proposalService (for the extraction trigger). Stub the rest.
  outlookService = new OutlookService(
    {} as any, // graphClient
    {} as any, // tokenService
    {} as any, // monitoredMailboxRepository
    {} as any, // emailRepository
    {} as any, // associationService
    projectRepository, // real — used by processAiResult's LINK branch
    {} as any, // documentPort
  );
});

const seedEmail = async (overrides: Record<string, unknown> = {}) => {
  return OutlookEmail.create({
    messageId: `msg-${Math.random().toString(36).slice(2)}`,
    mailboxUserId: 'user-1',
    receivedDateTime: new Date(),
    fromName: 'Jane Doe',
    fromAddress: 'jane@acme.com',
    subject: 'RE: 365 Poppasquash — revised scope',
    bodyText: 'Following up with revised requirements.',
    status: 'DRAFT',
    attachments: [
      {
        id: 'attachment-1',
        name: 'spec.pdf',
        storageKey: 'staging/spec-abc.pdf',
        blobUrl: 'https://blob/spec-abc.pdf',
      },
    ],
    ...overrides,
  });
};

describe('OutlookService.processAiResult — LINK action (existing project)', () => {
  it('links the email + documents to the existing project and triggers Stage 0 extraction', async () => {
    // --- Seed: an existing, already-approved project (analogous to "365 Poppasquash / Greg") ---
    const project = await Project.create({
      referenceNumber: 'REF-TEST-001',
      customerName: 'Jane Doe',
      projectType: ProjectType.NEW_ESTIMATE,
      projectName: '365 Poppasquash',
      status: ProjectStatus.SETUP_PENDING,
      creationSource: ProjectCreationSource.MAIL_FIRST,
    });

    const email = await seedEmail();

    // Document already staged (projectId: null) from ingestExternalPackage,
    // matching by storageKey the way processAiResult's LINK branch expects.
    await DocumentModel.create({
      rootDocumentId: 'root-doc-1',
      version: 1,
      isLatest: true,
      isActive: false,
      isFinalInput: false,
      documentType: 'other',
      status: 'STAGING',
      originalName: 'spec.pdf',
      mimeType: 'application/pdf',
      extension: '.pdf',
      storageKey: 'staging/spec-abc.pdf',
      blobUrl: 'https://blob/spec-abc.pdf',
      sha256: 'fake-sha-1',
      byteSize: 2048,
      uploadedBy: 'outlook-integration',
      projectId: null,
    });

    // Don't actually hit Azure Service Bus — just verify OutlookService calls it correctly.
    const triggerSpy = jest
      .spyOn(proposalService, 'triggerStage0Extraction')
      .mockResolvedValue(undefined);

    // --- Act: simulate the AI classifier's webhook payload ---
    await outlookService.processAiResult({
      correlationId: `outlookEmail:${email.id}`,
      action: 'LINK',
      projectId: project.id,
      proposed: { summary: 'Matches existing project', reasoning: 'Same address', confidence: 0.95 },
    });

    // --- Assert: email linked correctly ---
    const updatedEmail = await OutlookEmail.findById(email.id).lean();
    expect(updatedEmail!.status).toBe('CONFIRMED');
    expect(updatedEmail!.linkMethod).toBe('AUTO');
    expect(updatedEmail!.projectId?.toString()).toBe(project.id);

    // --- Assert: document moved onto the existing project ---
    const updatedDoc = await DocumentModel.findOne({ storageKey: 'staging/spec-abc.pdf' }).lean();
    expect(updatedDoc!.projectId?.toString()).toBe(project.id);
    expect(updatedDoc!.status).toBe('PROCESSED');
    expect(updatedDoc!.isActive).toBe(true);

    // --- Assert: extraction (queue 2) was triggered for the existing project ---
    expect(triggerSpy).toHaveBeenCalledTimes(1);
    expect(triggerSpy).toHaveBeenCalledWith(
      project.id,
      [updatedDoc!._id.toString()],
      expect.objectContaining({ correlationId: `outlookEmail:${email.id}` }),
    );
  });

  it('still confirms the link even if triggering extraction fails', async () => {
    const project = await Project.create({
      referenceNumber: 'REF-TEST-002',
      customerName: 'Jane Doe',
      projectType: ProjectType.NEW_ESTIMATE,
      projectName: '4 Jane Street',
      status: ProjectStatus.SETUP_PENDING,
      creationSource: ProjectCreationSource.MAIL_FIRST,
    });
    const email = await seedEmail({ attachments: [] });

    jest
      .spyOn(proposalService, 'triggerStage0Extraction')
      .mockRejectedValue(new Error('Service Bus unavailable'));

    await expect(
      outlookService.processAiResult({
        correlationId: `outlookEmail:${email.id}`,
        action: 'LINK',
        projectId: project.id,
        proposed: {},
      }),
    ).resolves.not.toThrow();

    const updatedEmail = await OutlookEmail.findById(email.id).lean();
    expect(updatedEmail!.status).toBe('CONFIRMED'); // link succeeded despite the trigger failing
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });
});

describe('OutlookService.processAiResult — DISCARD action', () => {
  it('marks the email as DISCARDED and stores the proposed metadata when action is DISCARD', async () => {
    const email = await seedEmail();

    const triggerSpy = jest
      .spyOn(proposalService, 'triggerStage0Extraction')
      .mockResolvedValue(undefined);

    await outlookService.processAiResult({
      correlationId: `outlookEmail:${email.id}`,
      action: 'DISCARD',
      proposed: {
        customerName: 'Not Real Corp',
        projectName: null,
        summary: 'This is spam, not a project inquiry',
        confidence: 0.98,
        reasoning: 'No job address or scope mentioned',
      },
    });

    const updatedEmail = await OutlookEmail.findById(email.id).lean();
    expect(updatedEmail!.status).toBe('DISCARDED');
    expect(updatedEmail!.proposed?.isProject).toBe(false);
    expect(updatedEmail!.proposed?.customerName).toBe('Not Real Corp');
    expect(updatedEmail!.proposed?.summary).toBe('This is spam, not a project inquiry');

    // DISCARD should never touch the extraction pipeline — no project to extract for.
    expect(triggerSpy).not.toHaveBeenCalled();
  });

  it('marks the email as DISCARDED when proposed.isProject is false, even without action: DISCARD', async () => {
    // This exercises the OR branch: `payload.proposed?.isProject === false || payload.action === 'DISCARD'`.
    // An AI worker could plausibly send action: 'LINK' or omit action entirely while
    // still signalling isProject: false — this should still discard, not fall through
    // to the LINK/CREATE branches.
    const email = await seedEmail();

    await outlookService.processAiResult({
      correlationId: `outlookEmail:${email.id}`,
      action: 'LINK', // deliberately NOT 'DISCARD'
      proposed: { isProject: false, summary: 'Not a real lead' },
    });

    const updatedEmail = await OutlookEmail.findById(email.id).lean();
    expect(updatedEmail!.status).toBe('DISCARDED');
    expect(updatedEmail!.proposed?.isProject).toBe(false);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });
});

describe('OutlookService.processAiResult — LINK action with missing projectId', () => {
  // Current behavior: processAiResult's `if (payload.action === 'LINK' && payload.projectId)`
  // guard means a LINK payload with no projectId fails that check, falls through the
  // CREATE/DRAFT branch (also false, since action isn't 'CREATE' and proposed.isProject
  // isn't true), and the function returns having done nothing at all — no status change,
  // no error, no log. This test locks in that (surprising) current behavior so it's
  // visible and intentional rather than a silent gap. If/when this is fixed to throw or
  // log instead, update this test's expectations accordingly.
  it('does not update the email, does not throw, and does not trigger extraction when projectId is missing', async () => {
    const email = await seedEmail();

    const triggerSpy = jest
      .spyOn(proposalService, 'triggerStage0Extraction')
      .mockResolvedValue(undefined);

    await expect(
      outlookService.processAiResult({
        correlationId: `outlookEmail:${email.id}`,
        action: 'LINK',
        // projectId intentionally omitted
        proposed: { summary: 'Matches existing project', reasoning: 'Same address', confidence: 0.95 },
      }),
    ).resolves.not.toThrow();

    // Email is left exactly as it was seeded — no status transition happened.
    const updatedEmail = await OutlookEmail.findById(email.id).lean();
    expect(updatedEmail!.status).toBe('DRAFT');
    // linkMethod/projectId both default to null at the schema level (not undefined —
    // see outlook-email.model.ts), so an untouched document has them as null.
    expect(updatedEmail!.linkMethod).toBeNull();
    expect(updatedEmail!.projectId).toBeNull();

    // No downstream side effects should have fired for a no-op.
    expect(triggerSpy).not.toHaveBeenCalled();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });
});

describe('OutlookService.processAiResult — CREATE action (new project draft)', () => {
  it('marks the email as DRAFT and stores the normalized proposed project when action is CREATE', async () => {
    const email = await seedEmail();

    await outlookService.processAiResult({
      correlationId: `outlookEmail:${email.id}`,
      action: 'CREATE',
      proposed: {
        customerName: 'Greg Smith',
        projectName: '365 Poppasquash',
        projectType: 'new estimate', // loose casing/spacing — should be normalized
        summary: 'New job inquiry, no existing project match',
        confidence: 0.87,
        reasoning: 'Unknown sender, new address',
        address: '365 Poppasquash Rd, Bristol, RI',
        // jobAddress intentionally omitted — should fall back to address
      },
    });

    const updatedEmail = await OutlookEmail.findById(email.id).lean();
    expect(updatedEmail!.status).toBe('DRAFT');
    expect(updatedEmail!.proposed?.isProject).toBe(true);
    expect(updatedEmail!.proposed?.customerName).toBe('Greg Smith');
    expect(updatedEmail!.proposed?.projectName).toBe('365 Poppasquash');
    // normalizeProjectType should coerce "new estimate" -> ProjectType.NEW_ESTIMATE
    expect(updatedEmail!.proposed?.projectType).toBe('NEW_ESTIMATE');
    expect(updatedEmail!.proposed?.address).toBe('365 Poppasquash Rd, Bristol, RI');
    // jobAddress falls back to address when the AI doesn't send one separately.
    expect(updatedEmail!.proposed?.jobAddress).toBe('365 Poppasquash Rd, Bristol, RI');
  });

  it('marks the email as DRAFT when proposed.isProject is true, even without action: CREATE', async () => {
    const email = await seedEmail();

    await outlookService.processAiResult({
      correlationId: `outlookEmail:${email.id}`,
      action: 'LINK', // deliberately NOT 'CREATE', and projectId omitted
      proposed: { isProject: true, customerName: 'Jane Doe', summary: 'Looks like a new lead' },
    });

    const updatedEmail = await OutlookEmail.findById(email.id).lean();
    expect(updatedEmail!.status).toBe('DRAFT');
    expect(updatedEmail!.proposed?.isProject).toBe(true);
  });

  it('falls back to ProjectType.NEW_ESTIMATE when projectType is missing or unrecognized', async () => {
    const email = await seedEmail();

    await outlookService.processAiResult({
      correlationId: `outlookEmail:${email.id}`,
      action: 'CREATE',
      proposed: {
        customerName: 'Test Customer',
        projectName: 'Unknown Type Job',
        projectType: 'not-a-real-type',
      },
    });

    const updatedEmail = await OutlookEmail.findById(email.id).lean();
    expect(updatedEmail!.proposed?.projectType).toBe('NEW_ESTIMATE');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });
});

describe('OutlookService.processAiResult — LINK action called twice (retry/idempotency)', () => {
  // Simulates an AI worker retrying the same webhook delivery (e.g. after a timeout
  // it never saw the 200 for). There is no guard in processAiResult checking whether
  // the email is already CONFIRMED/linked before re-running the LINK branch, so this
  // test documents current behavior: the email update is harmlessly idempotent (same
  // final state either way), but triggerStage0Extraction fires once PER call — i.e.
  // a duplicate webhook delivery currently means duplicate extraction triggers.
  it('re-confirms the email but triggers Stage 0 extraction a second time on a duplicate LINK call', async () => {
    const project = await Project.create({
      referenceNumber: 'REF-TEST-003',
      customerName: 'Jane Doe',
      projectType: ProjectType.NEW_ESTIMATE,
      projectName: 'Duplicate Delivery Test',
      status: ProjectStatus.SETUP_PENDING,
      creationSource: ProjectCreationSource.MAIL_FIRST,
    });
    const email = await seedEmail({ attachments: [] });

    const triggerSpy = jest
      .spyOn(proposalService, 'triggerStage0Extraction')
      .mockResolvedValue(undefined);

    const payload = {
      correlationId: `outlookEmail:${email.id}`,
      action: 'LINK',
      projectId: project.id,
      proposed: { summary: 'Matches existing project', reasoning: 'Same address', confidence: 0.95 },
    };

    // First delivery.
    await outlookService.processAiResult(payload);
    // Simulated retry — same payload, as an AI worker might send after a timeout.
    await outlookService.processAiResult(payload);

    const updatedEmail = await OutlookEmail.findById(email.id).lean();
    // End state is still correct/consistent — the update itself is idempotent.
    expect(updatedEmail!.status).toBe('CONFIRMED');
    expect(updatedEmail!.linkMethod).toBe('AUTO');
    expect(updatedEmail!.projectId?.toString()).toBe(project.id);

    // But the extraction trigger — a real side effect, not just a DB write —
    // fired twice. This is the concrete cost of not de-duplicating retries.
    expect(triggerSpy).toHaveBeenCalledTimes(2);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });
});