import mongoose from 'mongoose';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import type { Express } from 'express';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { AuthProvider, User, UserRole } from '@db/models/user.model';
import { Project, ProjectCreationSource } from '@db/models/project.model';

jest.mock('@repositories/azure/azure-blob.repository', () => ({
  AzureBlobRepository: class {
    public getProjectRootPath(projectId: string): string {
      return `projects/${projectId}`;
    }
    public async createFolderStructure(): Promise<void> {
      return;
    }
    public async uploadFile(): Promise<string> {
      return 'fake://uploaded';
    }
    public async getDownloadUrl(): Promise<string> {
      return 'fake://download';
    }
    public async deleteFile(): Promise<void> {
      return;
    }
  },
}));

let mongod: MongoMemoryServer;
let app: Express;

const SALES_EMAIL = 'sm@gfs-test.com';
const SALES_PASSWORD = 'Sm@Test123!';
const EST_EMAIL = 'est@gfs-test.com';
const EST_PASSWORD = 'Est@Test123!';

const seedUser = async (email: string, password: string, role: UserRole): Promise<void> => {
  const passwordHash = await bcrypt.hash(password, 10);
  await User.findOneAndUpdate(
    { email },
    {
      email,
      passwordHash,
      authProvider: AuthProvider.LOCAL,
      role,
      firstName: 'Test',
      lastName: 'User',
      isActive: true,
      refreshTokenHash: null,
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );
};

const extractCookies = (res: request.Response): string[] => {
  const cookies = res.headers['set-cookie'];
  if (!cookies) throw new Error('No set-cookie header in response');
  return Array.isArray(cookies) ? cookies : [cookies];
};

const loginAs = async (email: string, password: string): Promise<string[]> => {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  return extractCookies(res);
};

beforeAll(async () => {
  process.env['JWT_SECRET'] = process.env['JWT_SECRET'] ?? 'test-access-secret';
  process.env['JWT_REFRESH_SECRET'] = process.env['JWT_REFRESH_SECRET'] ?? 'test-refresh-secret';
  process.env['MAIL_HOST'] = process.env['MAIL_HOST'] ?? 'smtp.test';
  process.env['MAIL_USER'] = process.env['MAIL_USER'] ?? 'test@test.com';
  process.env['MAIL_PASS'] = process.env['MAIL_PASS'] ?? 'test-pass';

  mongod = await MongoMemoryServer.create();
  process.env['MONGODB_URI'] = mongod.getUri();

  const appModule = await import('../../src/app.js');
  app = appModule.app;

  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Project.deleteMany({});
  await User.deleteMany({});
  await seedUser(SALES_EMAIL, SALES_PASSWORD, UserRole.SALES_MANAGER);
  await seedUser(EST_EMAIL, EST_PASSWORD, UserRole.ESTIMATOR);
});

describe('POST /api/v1/projects', () => {
  const body = {
    projectName: 'Acme Storefront Glazing',
    projectType: 'NEW_ESTIMATE',
    projectAddress: '120 Market St, Suite 4',
    description: 'Replace 6 shopfront panels.',
    client: {
      customerName: 'Jane Doe',
      customerEmail: 'jane@acme.com',
      customerPhone: '0400000000',
      company: 'Acme Corp',
      website: 'https://acme.com',
    },
    address: {
      street: '120 Market St',
      city: 'San Francisco',
      state: 'CA',
      zipcode: '94103',
      country: 'USA',
    },
  };

  it('returns 401 without auth', async () => {
    const res = await request(app).post('/api/v1/projects').send(body);
    expect(res.status).toBe(401);
  });

  it('returns 403 for an estimator (not authorized to create)', async () => {
    const cookies = await loginAs(EST_EMAIL, EST_PASSWORD);
    const res = await request(app).post('/api/v1/projects').set('Cookie', cookies).send(body);
    expect(res.status).toBe(403);
  });

  it('creates a MANUAL project and returns a CentralizedProjectView', async () => {
    const cookies = await loginAs(SALES_EMAIL, SALES_PASSWORD);
    const res = await request(app).post('/api/v1/projects').set('Cookie', cookies).send(body);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);

    const view = res.body.data;
    expect(view.creationSource).toBe('MANUAL');
    expect(view.projectName).toBe('Acme Storefront Glazing');
    expect(view.projectAddress).toBe('120 Market St, Suite 4');
    expect(view.referenceNumber).toMatch(/^GFS-\d{4}-\d+$/);
    expect(view.client).toMatchObject({
      customerName: 'Jane Doe',
      customerEmail: 'jane@acme.com',
      company: 'Acme Corp',
      website: 'https://acme.com',
    });
    expect(view.address).toMatchObject({ city: 'San Francisco', zipcode: '94103' });
    expect(view.zohoLeadId).toBeNull();

    const persisted = await Project.findById(view.id).lean();
    expect(persisted).not.toBeNull();
    expect(persisted!.creationSource).toBe(ProjectCreationSource.MANUAL);
    expect(persisted!.customerEmail).toBe('jane@acme.com');
    expect(persisted!.address?.zipcode).toBe('94103');
  });

  it('rejects an empty body (missing projectName)', async () => {
    const cookies = await loginAs(SALES_EMAIL, SALES_PASSWORD);
    const res = await request(app).post('/api/v1/projects').set('Cookie', cookies).send({});
    expect(res.status).toBe(400);
  });
});
