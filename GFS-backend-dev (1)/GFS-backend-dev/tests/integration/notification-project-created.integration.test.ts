import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { Project } from '@db/models/project.model';
import { ZohoLead } from '@db/models/zoho-lead.model';
import { Sequence } from '@db/models/sequence.model';
import { Notification, NotificationType } from '@db/models/notification.model';
import { UserRole } from '@db/models/user.model';
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
  Lead_Status: 'Need to Quote',
  ...overrides,
});

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  const { projectRepository, projectCreationService } = buildProjectCreation();
  const projectService = new ZohoProjectService(projectCreationService, projectRepository);
  const notificationService = new NotificationService(new MongooseNotificationRepository());
  const zohoServiceStub = {} as ZohoService;
  syncService = new ZohoSyncService(zohoServiceStub, projectService, notificationService);
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
  ]);
});

describe('Zoho "Need to Quote" → PROJECT_CREATED notification', () => {
  it('emits one notification targeting sales managers when a project is created', async () => {
    await syncService.syncLead(rawLead(), 'webhook', new Date());

    const project = await Project.findOne({ zohoLeadId: 'zlead-1' }).lean();
    expect(project).not.toBeNull();

    const notifications = await Notification.find({}).lean();
    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.type).toBe(NotificationType.PROJECT_CREATED);
    expect(notifications[0]!.roles).toEqual([UserRole.SALES_MANAGER]);
    expect(notifications[0]!.projectId?.toString()).toBe(project!._id.toString());
    expect(notifications[0]!.payload).toMatchObject({ projectName: 'Acme Corp' });
  });

  it('does not emit a second notification when the same lead is synced again', async () => {
    await syncService.syncLead(rawLead(), 'webhook', new Date());
    await syncService.syncLead(rawLead(), 'webhook', new Date());

    await expect(Notification.countDocuments({})).resolves.toBe(1);
    await expect(Project.countDocuments({})).resolves.toBe(1);
  });

  it('does not emit a notification for leads that are not "Need to Quote"', async () => {
    await syncService.syncLead(rawLead({ Lead_Status: 'Attempted to Contact' }), 'webhook', new Date());

    await expect(Notification.countDocuments({})).resolves.toBe(0);
  });
});
