import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { Project, ProjectStatus, ProjectType, ProjectCreationSource } from '@db/models/project.model';
import { ZohoLead } from '@db/models/zoho-lead.model';
import { Sequence } from '@db/models/sequence.model';
import { ProjectParameter } from '@db/models/project-parameter.model';
import { ZohoProjectService } from '@features/zoho/zoho-project.service';
import { buildProjectCreation } from '../support/project-creation.factory';

let mongod: MongoMemoryServer;
let service: ZohoProjectService;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Project.syncIndexes();
  const { projectRepository, projectCreationService } = buildProjectCreation();
  service = new ZohoProjectService(projectCreationService, projectRepository);
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
    ProjectParameter.deleteMany({}),
  ]);
});

const seedLead = async (overrides: Record<string, unknown> = {}) => {
  return ZohoLead.create({
    zohoLeadId: 'zoho-lead-001',
    firstName: 'Jane',
    lastName: 'Doe',
    fullName: 'Jane Doe',
    company: 'Acme Corp',
    email: 'jane@acme.com',
    phone: '0400000000',
    website: 'https://acme.com',
    jobAddress: '120 Market St, Suite 4',
    description: 'Replace shopfront panels',
    street: '120 Market St',
    city: 'San Francisco',
    state: 'CA',
    zipCode: '94103',
    country: 'USA',
    createdTime: new Date('2026-06-22T09:14:00.000Z'),
    fetchedAt: new Date(),
    projectId: null,
    raw: {},
    ...overrides,
  });
};

describe('ZohoProjectService integration — createProjectFromLead', () => {
  it('creates a project with all centralized fields copied and writes projectId back', async () => {
    await seedLead({ zohoLeadId: 'z-001' });

    const created = await service.createProjectFromLead('z-001');
    expect(created).not.toBeNull();

    const project = await Project.findOne({ zohoLeadId: 'z-001' }).lean();
    expect(project).not.toBeNull();
    expect(project!.projectName).toBe('120 Market St, Suite 4');
    expect(project!.customerName).toBe('Jane Doe');
    expect(project!.customerEmail).toBe('jane@acme.com');
    expect(project!.customerPhone).toBe('0400000000');
    expect(project!.company).toBe('Acme Corp');
    expect(project!.customerWebsite).toBe('https://acme.com');
    expect(project!.description).toBe('Replace shopfront panels');
    expect(project!.jobAddress).toBe('120 Market St, Suite 4');
    expect(project!.creationSource).toBe(ProjectCreationSource.ZOHO_FIRST);
    expect(project!.status).toBe(ProjectStatus.SETUP_PENDING);
    expect(project!.projectType).toBe(ProjectType.NEW_ESTIMATE);
    expect(project!.address?.city).toBe('San Francisco');
    expect(project!.address?.zipcode).toBe('94103');
    expect(project!.receivedDate?.toISOString()).toBe('2026-06-22T09:14:00.000Z');
    expect(project!.referenceNumber).toMatch(/^GFS-\d{4}-\d+$/);

    const lead = await ZohoLead.findOne({ zohoLeadId: 'z-001' }).lean();
    expect(lead!.projectId?.toString()).toBe(project!._id.toString());
  });

  it('generates sequential reference numbers', async () => {
    await seedLead({ zohoLeadId: 'z-001', company: 'Alpha' });
    await seedLead({ zohoLeadId: 'z-002', company: 'Beta' });

    await service.createProjectFromLead('z-001');
    await service.createProjectFromLead('z-002');

    const projects = await Project.find({}).sort({ referenceNumber: 1 }).lean();
    expect(projects).toHaveLength(2);
    const year = new Date().getFullYear();
    expect(projects[0]!.referenceNumber).toBe(`GFS-${year}-1001`);
    expect(projects[1]!.referenceNumber).toBe(`GFS-${year}-1002`);
  });

  it('does not create a second project when called twice for the same lead', async () => {
    await seedLead({ zohoLeadId: 'z-001' });

    await service.createProjectFromLead('z-001');
    const second = await service.createProjectFromLead('z-001');

    expect(second).toBeNull();
    expect(await Project.countDocuments({})).toBe(1);
  });

  it('is idempotent when the lead already has a projectId', async () => {
    const existingProjectId = new mongoose.Types.ObjectId();
    await seedLead({ zohoLeadId: 'z-001', projectId: existingProjectId });

    const res = await service.createProjectFromLead('z-001');

    expect(res).toBeNull();
    expect(await Project.countDocuments({})).toBe(0);
  });

  it('creates exactly one project under concurrent calls for the same lead (unique index)', async () => {
    await seedLead({ zohoLeadId: 'z-001' });

    await Promise.all([
      service.createProjectFromLead('z-001'),
      service.createProjectFromLead('z-001'),
    ]);

    expect(await Project.countDocuments({ zohoLeadId: 'z-001' })).toBe(1);
  });

  it('does nothing when the lead does not exist', async () => {
    const res = await service.createProjectFromLead('z-999');

    expect(res).toBeNull();
    expect(await Project.countDocuments({})).toBe(0);
  });

  it('marks creationSource MAIL_FIRST when the lead is tagged', async () => {
    await seedLead({ zohoLeadId: 'z-001', raw: { Platform_Source: 'MAIL_FIRST' } });

    await service.createProjectFromLead('z-001');

    const project = await Project.findOne({ zohoLeadId: 'z-001' }).lean();
    expect(project!.creationSource).toBe(ProjectCreationSource.MAIL_FIRST);
  });
});

describe('ZohoProjectService integration — syncProjectFromLead', () => {
  it('updates mirrored Project fields and stamps lastZohoSyncedAt', async () => {
    await seedLead({ zohoLeadId: 'z-001' });
    const created = await service.createProjectFromLead('z-001');

    await service.syncProjectFromLead(created!.id, {
      fullName: 'Janet Doe',
      email: 'janet@acme.com',
      phone: '0411111111',
      company: 'Acme Holdings',
      website: 'https://acme.io',
      description: 'Updated scope',
      jobAddress: '500 New St',
      leadStatus: 'Need to Quote',
      street: '500 New St',
      city: 'Oakland',
      state: 'CA',
      zipCode: '94601',
      country: 'USA',
      createdTime: new Date('2026-06-22T09:14:00.000Z'),
    });

    const project = await Project.findById(created!.id).lean();
    expect(project!.customerName).toBe('Janet Doe');
    expect(project!.customerEmail).toBe('janet@acme.com');
    expect(project!.company).toBe('Acme Holdings');
    expect(project!.customerWebsite).toBe('https://acme.io');
    expect(project!.address?.city).toBe('Oakland');
    expect(project!.address?.zipcode).toBe('94601');
    expect(project!.lastZohoSyncedAt).toBeTruthy();
  });
});
