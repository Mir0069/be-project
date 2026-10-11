import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { Project } from '@db/models/project.model';
import { ZohoLead } from '@db/models/zoho-lead.model';
import { Sequence } from '@db/models/sequence.model';
import { Notification } from '@db/models/notification.model';
import { ProjectParameter } from '@db/models/project-parameter.model';
import { ZohoLeadChange } from '@db/models/zoho-lead-change.model';
import { ZohoProjectService } from '@features/zoho/zoho-project.service';
import { ZohoSyncService } from '@features/zoho/zoho-sync.service';
import { NotificationService } from '@features/notifications/notification.service';
import { MongooseNotificationRepository } from '@repositories/mongoose/notification.repository';
import { buildProjectCreation } from '../support/project-creation.factory';
import type { ZohoService } from '@features/zoho/zoho.service';

let mongod: MongoMemoryServer;
let syncService: ZohoSyncService;

const rawLead = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'zlead-1',
  First_Name: 'Test',
  Last_Name: 'Lead',
  Company: 'Acme Corp',
  Phone: '0400000000',
  Email: 'a@acme.com',
  Lead_Status: 'Need to Quote',
  ...overrides,
});

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  const { projectRepository, projectCreationService } = buildProjectCreation();
  const projectService = new ZohoProjectService(projectCreationService, projectRepository);
  const notificationService = new NotificationService(new MongooseNotificationRepository());
  syncService = new ZohoSyncService({} as ZohoService, projectService, notificationService);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Promise.all([
    Project.deleteMany({}),
    ZohoLead.deleteMany({}),
    Sequence.deleteMany({}),
    Notification.deleteMany({}),
    ProjectParameter.deleteMany({}),
    ZohoLeadChange.deleteMany({}),
  ]);
});

describe('Zoho reconcile / poll → project lifecycle', () => {
  it('creates the project when a "Need to Quote" lead first arrives via poll', async () => {
    await syncService.syncLead(rawLead(), 'poll', new Date());

    expect(await Project.countDocuments({ zohoLeadId: 'zlead-1' })).toBe(1);
  });

  it('does not create a second project when the status flips away and back', async () => {
    await syncService.syncLead(rawLead(), 'webhook', new Date());
    await syncService.syncLead(rawLead({ Lead_Status: 'Contacted' }), 'webhook', new Date());
    await syncService.syncLead(rawLead({ Lead_Status: 'Need to Quote' }), 'webhook', new Date());

    expect(await Project.countDocuments({ zohoLeadId: 'zlead-1' })).toBe(1);
  });

  it('propagates linked-lead field changes to the Project without a new notification', async () => {
    await syncService.syncLead(rawLead(), 'webhook', new Date());
    await syncService.syncLead(
      rawLead({ Email: 'updated@acme.com', Phone: '0499999999' }),
      'webhook',
      new Date(),
    );

    const project = await Project.findOne({ zohoLeadId: 'zlead-1' }).lean();
    expect(project!.customerEmail).toBe('updated@acme.com');
    expect(project!.customerPhone).toBe('0499999999');
    expect(project!.lastZohoSyncedAt).toBeTruthy();

    expect(await Notification.countDocuments({})).toBe(1);
  });
});
