import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { Project, ProjectStatus, ProjectCreationSource } from '@db/models/project.model';
import { ZohoLead } from '@db/models/zoho-lead.model';
import { ZohoLeadChange } from '@db/models/zoho-lead-change.model';
import { Sequence } from '@db/models/sequence.model';
import { ProjectParameter } from '@db/models/project-parameter.model';
import { OutlookEmail } from '@db/models/outlook-email.model';
import { DocumentModel } from '@db/models/document.model';
import { ZohoProjectService } from '@features/zoho/zoho-project.service';
import { ZohoSyncService } from '@features/zoho/zoho-sync.service';
import { MailFirstService } from '@features/mail-first/mail-first.service';
import type { ZohoService } from '@features/zoho/zoho.service';
import { buildProjectCreation } from '../support/project-creation.factory';

class FakeZohoService {
  public inserts: Array<{ path: string; payload: any }> = [];
  private leadStore: Record<string, Record<string, unknown>> = {};

  public async insertIntoZoho(path: string, payload: any): Promise<unknown> {
    this.inserts.push({ path, payload });
    const { Platform_Source, ...rest } = payload.data[0];
    void Platform_Source;
    const id = `mail-lead-${this.inserts.length.toString().padStart(3, '0')}`;
    this.leadStore[id] = { ...rest, id };
    return { data: [{ code: 'SUCCESS', status: 'success', details: { id } }] };
  }

  public async fetchFromZoho(path: string): Promise<unknown> {
    const id = path.split('/').pop() as string;
    const raw = this.leadStore[id];
    return { data: raw ? [raw] : [] };
  }
}

let mongod: MongoMemoryServer;
let fakeZoho: FakeZohoService;
let service: MailFirstService;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Project.syncIndexes();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Promise.all([
    Project.deleteMany({}),
    ZohoLead.deleteMany({}),
    ZohoLeadChange.deleteMany({}),
    Sequence.deleteMany({}),
    ProjectParameter.deleteMany({}),
    OutlookEmail.deleteMany({}),
    DocumentModel.deleteMany({}),
  ]);

  fakeZoho = new FakeZohoService();
  const { projectRepository, projectCreationService } = buildProjectCreation();
  const zohoProjectService = new ZohoProjectService(projectCreationService, projectRepository);
  const zohoSyncService = new ZohoSyncService(fakeZoho as unknown as ZohoService, zohoProjectService);
  const fakeBlobStorage = {
    createSignedDownloadUrl: async () => 'https://signed.example/url',
  };
  service = new MailFirstService(fakeZoho as unknown as ZohoService, zohoSyncService, fakeBlobStorage as any);
});

const seedDraft = async (overrides: Record<string, unknown> = {}) => {
  return OutlookEmail.create({
    messageId: `msg-${Math.random().toString(36).slice(2)}`,
    mailboxUserId: 'user-1',
    receivedDateTime: new Date(),
    fromName: 'Jane Doe',
    fromAddress: 'jane@acme.com',
    subject: 'New shopfront quote',
    bodyText: 'We need a quote for new shopfront panels.',
    status: 'DRAFT',
    proposed: {
      isProject: true,
      customerName: 'Jane Doe',
      companyName: 'Acme Corp',
      projectName: 'Acme Shopfront',
      projectType: 'NEW_ESTIMATE',
      summary: 'Replace shopfront panels',
      confidence: 0.9,
    },
    ...overrides,
  });
};

describe('MailFirstService — approveDraft', () => {
  it('creates a MAIL_FIRST project even when Zoho drops the Platform_Source tag', async () => {
    const email = await seedDraft();

    const result = await service.approveDraft(email.id);

    expect(fakeZoho.inserts).toHaveLength(1);
    expect(fakeZoho.inserts[0]!.path).toBe('/crm/v2/Leads');
    const sentLead = fakeZoho.inserts[0]!.payload.data[0];
    expect(sentLead.Lead_Status).toBe('Need to Quote');
    expect(sentLead.Platform_Source).toBe('MAIL_FIRST');
    expect(sentLead.Email).toBe('jane@acme.com');
    expect(sentLead.Company).toBe('Acme Corp');

    expect(result.zohoLeadId).toBe('mail-lead-001');
    expect(result.projectId).toBeTruthy();
    expect(result.alreadyProcessed).toBe(false);

    const project = await Project.findOne({
      zohoLeadId: 'mail-lead-001',
    }).lean();
    expect(project).not.toBeNull();
    expect(project!.creationSource).toBe(ProjectCreationSource.MAIL_FIRST);
    // Approving hands the project straight to the AI, so it is waiting on
    // extraction rather than sitting in setup. Every approve publishes
    // BEGIN_EXTRACTION now, documents or not: notes, Teams messages and mail
    // bodies are context the AI needs whether or not a drawing came with them.
    expect(project!.status).toBe(ProjectStatus.WAITING_FOR_INPUTS);

    const refreshed = await OutlookEmail.findById(email.id).lean();
    expect(refreshed!.status).toBe('CONFIRMED');
    expect(refreshed!.projectId?.toString()).toBe(project!._id.toString());

    const lead = await ZohoLead.findOne({ zohoLeadId: 'mail-lead-001' }).lean();
    expect(lead!.projectId?.toString()).toBe(project!._id.toString());
  });

  it('keeps the contact person separate from the AI-extracted company', async () => {
    const email = await seedDraft({
      fromName: 'Awais',
      proposed: {
        isProject: true,
        customerName: 'Awais',
        companyName: 'Example Design Group',
        projectName: 'Example Project',
        projectType: 'NEW_ESTIMATE',
        summary: 'New project request',
        confidence: 0.9,
      },
    });

    await service.approveDraft(email.id);

    const sentLead = fakeZoho.inserts[0]!.payload.data[0];
    expect(sentLead.Last_Name).toBe('Awais');
    expect(sentLead.Company).toBe('Example Design Group');

    const project = await Project.findOne({
      zohoLeadId: 'mail-lead-001',
    }).lean();
    expect(project?.customerName).toBe('Awais');
    expect(project?.company).toBe('Example Design Group');
  });

  it('links staged cloud documents to the created project', async () => {
    const email = await seedDraft();

    // Create a mock staged cloud document linked to this email's ID
    const doc = await DocumentModel.create({
      rootDocumentId: 'root-doc-123',
      version: 1,
      isLatest: true,
      isActive: true,
      isFinalInput: false,
      documentType: 'other',
      status: 'STAGING',
      originalName: 'cloud-file.pdf',
      mimeType: 'application/pdf',
      extension: '.pdf',
      storageKey: 'documents/staging/cloud-link/ab/abc.pdf',
      blobUrl: 'https://storage.example/abc.pdf',
      sha256: 'abc123sha256',
      byteSize: 1024,
      uploadedBy: 'test-user',
      metadata: {
        source: 'cloud-link',
        emailId: email.id,
      },
    });

    const result = await service.approveDraft(email.id);

    expect(result.projectId).toBeTruthy();

    // Check that the cloud document was linked to the project and status was updated to PROCESSED
    const updatedDoc = await DocumentModel.findById(doc._id).lean();
    expect(updatedDoc).not.toBeNull();
    expect(updatedDoc!.projectId?.toString()).toBe(result.projectId);
    expect(updatedDoc!.status).toBe('PROCESSED');
    expect(updatedDoc!.isActive).toBe(true);
  });

  it('is idempotent — approving an already-confirmed draft creates no second lead or project', async () => {
    const email = await seedDraft();

    await service.approveDraft(email.id);
    const second = await service.approveDraft(email.id);

    expect(second.alreadyProcessed).toBe(true);
    expect(fakeZoho.inserts).toHaveLength(1);
    expect(await Project.countDocuments({})).toBe(1);
  });

  it('advances past a stale duplicate reference and confirms only the created project', async () => {
    const year = new Date().getFullYear();
    await Sequence.create({ _id: `GFS-${year}`, sequenceValue: 1000 });
    await Project.create({
      referenceNumber: `GFS-${year}-1001`,
      projectName: 'Existing project',
      customerName: 'Existing customer',
      projectType: 'NEW_ESTIMATE',
      status: ProjectStatus.SETUP_PENDING,
      creationSource: ProjectCreationSource.MANUAL,
      isActive: true,
    });
    const email = await seedDraft();

    const result = await service.approveDraft(email.id);

    expect(result.projectId).toBeTruthy();
    const project = await Project.findById(result.projectId).lean();
    expect(project?.referenceNumber).toBe(`GFS-${year}-1002`);

    const refreshed = await OutlookEmail.findById(email.id).lean();
    expect(refreshed?.status).toBe('CONFIRMED');
    expect(refreshed?.projectId?.toString()).toBe(result.projectId);
    expect(refreshed?.zohoLeadId).toBe('mail-lead-001');
  });

  it('creates and links one project per bidder for a competitive draft', async () => {
    const email = await seedDraft({
      proposed: {
        isProject: true,
        customerName: 'Acme Corp',
        companyName: 'Acme Corp',
        projectName: 'Acme Shopfront',
        projectType: 'NEW_ESTIMATE',
        summary: 'Competitive shopfront bid',
        confidence: 0.95,
        isCompetitiveBid: true,
        groupId: 'competitive-group-001',
        primaryBidderEmail: 'jane@acme.com',
        allBidders: [
          { email: 'jane@acme.com', company: 'Acme Corp', isPrimary: true },
          {
            email: 'sam@beta.example',
            company: 'Beta Builders',
            isPrimary: false,
          },
        ],
      },
    });

    const result = await service.approveDraft(email.id);

    expect(result.allProjectIds).toHaveLength(2);
    expect(fakeZoho.inserts).toHaveLength(2);
    const projects = await Project.find({
      groupId: 'competitive-group-001',
    }).lean();
    expect(projects).toHaveLength(2);
    expect(projects.map((project) => project.customerEmail).sort()).toEqual(['jane@acme.com', 'sam@beta.example']);
    expect(projects.every((project) => project.isCompetitiveBid)).toBe(true);
    expect(projects.every((project) => project.relatedProjectIds?.length === 1)).toBe(true);

    const refreshed = await OutlookEmail.findById(email.id).lean();
    expect(refreshed!.status).toBe('CONFIRMED');
    expect(refreshed!.projectId?.toString()).toBe(result.projectId);
  });

  it('rejects approval of an email that is not a DRAFT', async () => {
    const email = await seedDraft({ status: 'PENDING' });

    await expect(service.approveDraft(email.id)).rejects.toThrow(/status PENDING/);
    expect(fakeZoho.inserts).toHaveLength(0);
  });

  it('throws when the email does not exist', async () => {
    const missingId = new mongoose.Types.ObjectId().toString();
    await expect(service.approveDraft(missingId)).rejects.toThrow(/not found/);
  });
});

describe('MailFirstService — listPendingDrafts', () => {
  it('returns the stored HTML body with the plain-text fallback', async () => {
    const email = await seedDraft({
      bodyHtml: '<p>Hello <strong>GFS</strong></p><ul><li>Glass deck</li></ul>',
    });

    const drafts = await service.listPendingDrafts();
    const draft = drafts.find((item) => item.id === email.id);

    expect(draft).toMatchObject({
      bodyText: 'We need a quote for new shopfront panels.',
      bodyHtml: '<p>Hello <strong>GFS</strong></p><ul><li>Glass deck</li></ul>',
    });
  });
});

describe('MailFirstService — rejectDraft', () => {
  it('marks the draft DISCARDED and creates no lead', async () => {
    const email = await seedDraft();

    await service.rejectDraft(email.id);

    const refreshed = await OutlookEmail.findById(email.id).lean();
    expect(refreshed!.status).toBe('DISCARDED');
    expect(fakeZoho.inserts).toHaveLength(0);
    expect(await Project.countDocuments({})).toBe(0);
  });

  it('is a no-op when already discarded', async () => {
    const email = await seedDraft({ status: 'DISCARDED' });
    await expect(service.rejectDraft(email.id)).resolves.toBeUndefined();
  });
});

describe('MailFirstService — updateDraftProjectName', () => {
  it('updates the proposed projectName on a DRAFT email', async () => {
    const email = await seedDraft();

    const result = await service.updateDraftProjectName(email.id, 'Renamed Shopfront');

    expect(result.projectName).toBe('Renamed Shopfront');

    const refreshed = await OutlookEmail.findById(email.id).lean();
    expect(refreshed!.proposed!.projectName).toBe('Renamed Shopfront');
  });

  it('throws when the email is not in DRAFT status', async () => {
    const email = await seedDraft({ status: 'PENDING' });

    await expect(service.updateDraftProjectName(email.id, 'New Name')).rejects.toThrow(/status PENDING/);
  });

  it('throws when the email does not exist', async () => {
    const missingId = new mongoose.Types.ObjectId().toString();
    await expect(service.updateDraftProjectName(missingId, 'New Name')).rejects.toThrow(/not found/);
  });

  it('edited projectName flows through to the created project name', async () => {
    const email = await seedDraft({
      proposed: {
        isProject: true,
        customerName: 'Acme Corp',
        projectName: 'Original AI Name',
        projectType: 'NEW_ESTIMATE',
        summary: 'Replace shopfront panels',
        confidence: 0.9,
      },
    });

    await service.updateDraftProjectName(email.id, 'Acme Shopfront Renovation');
    const result = await service.approveDraft(email.id);

    expect(result.projectId).toBeTruthy();
    const project = await Project.findById(result.projectId).lean();
    expect(project!.projectName).toBe('Acme Shopfront Renovation');
  });
});
