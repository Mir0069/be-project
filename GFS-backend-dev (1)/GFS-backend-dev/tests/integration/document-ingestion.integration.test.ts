  process.env['JWT_SECRET'] = 'test-access-secret';
  process.env['JWT_REFRESH_SECRET'] = 'test-refresh-secret';
  process.env['ZOHO_CLIENT_ID'] = 'dummy_zoho_id';
  process.env['ZOHO_CLIENT_SECRET'] = 'dummy_zoho_secret';
  process.env['ZOHO_REDIRECT_URI'] = 'http://localhost/callback';
  process.env['QUEUE_PROVIDER'] = 'in_memory';


import mongoose from 'mongoose';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import type { Express } from 'express';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { AuthProvider, User, UserRole } from '@db/models/user.model';
import { Project, ProjectStatus, ProjectType } from '@db/models/project.model';
import { expectNoMongooseInternals } from '../support/expect-no-mongoose-internals';
import * as authMiddleware from '@features/auth/auth.middleware';


jest.mock('@features/auth/auth.middleware', () => {
  const original = jest.requireActual('@features/auth/auth.middleware');
  return {
    ...original,
    authenticate: jest.fn(),
  };
});

jest.mock('@features/document-ingestion/document-ingestion.service', () => {
  const original = jest.requireActual('@features/document-ingestion/document-ingestion.service');
  return {
    ...original,
    AzureContentAddressedBlobStorage: jest.fn().mockImplementation(() => ({
      put: jest.fn().mockResolvedValue({
        storageKey: 'test/key',
        blobUrl: 'https://fake.blob',
        sha256: 'hash',
        byteSize: 100,
      }),
      delete: jest.fn().mockResolvedValue(undefined),
      createSignedDownloadUrl: jest.fn().mockResolvedValue('https://fake.blob/download'),
    })),
  };
});


let app: Express;
let mongod: MongoMemoryServer;

const ESTIMATOR_EMAIL = 'estimator@gfs-test.com';
const ESTIMATOR_PASSWORD = 'Estimator@Test123!';

const seedUser = async (email: string, password: string, role: UserRole): Promise<string> => {
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await User.findOneAndUpdate(
    { email },
    {
      email, passwordHash, authProvider: AuthProvider.LOCAL,
      role, firstName: 'Test', lastName: 'User', isActive: true,
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );
  return user!._id.toString();
};

const seedProject = async (estimatorId: string): Promise<string> => {
  const project = await Project.create({
    referenceNumber: `GFS-${Date.now()}`,
    projectName: 'Test Document Project',
    customerName: 'Acme Corp',
    status: ProjectStatus.SETUP_PENDING,
    projectType: ProjectType.NEW_ESTIMATE,
    assignedEstimators: [estimatorId],
  });

  return (project._id as any).toString();
};

const loginAs = async (email: string, password: string): Promise<string[]> => {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  const cookies = res.headers['set-cookie'];
  if (!cookies) throw new Error(`Login failed: no set-cookie header. Status: ${res.status}`);
  return Array.isArray(cookies) ? cookies : [cookies];
};


beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  process.env['MONGODB_URI'] = uri;

  await mongoose.connect(uri);
  const appModule = await import('../../src/app.js');
  app = appModule.app;
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

// Tests 

describe('Document Ingestion Router (Integration)', () => {
  let estimatorId: string;
  let projectId: string;
  let cookies: string[];

  beforeEach(async () => {

    estimatorId = await seedUser(ESTIMATOR_EMAIL, ESTIMATOR_PASSWORD, UserRole.ESTIMATOR);
    projectId = await seedProject(estimatorId);

    (authMiddleware.authenticate as jest.Mock).mockImplementation(
      (req: any, _res: any, next: any) => {
        req.user = { userId: estimatorId, role: UserRole.ESTIMATOR };
        next();
      },
    );

    cookies = await loginAs(ESTIMATOR_EMAIL, ESTIMATOR_PASSWORD);
  });

  it('POST /projects/:projectId/documents — should upload a file (201)', async () => {
    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/documents`)
      .set('Cookie', cookies)
      .attach('file', Buffer.from('fake pdf content'), 'architect-drawing.pdf')
      .field('documentType', 'drawing')
      .field('markAsFinalInput', 'true');

    expect(res.status).toBe(201);
    expect(res.body.data.documents).toHaveLength(1);
    expect(res.body.data.documents[0].originalName).toBe('architect-drawing.pdf');
    expect(res.body.data.documents[0].projectId).toBe(projectId);
    expectNoMongooseInternals(res.body);
  });

  it('GET /projects/:projectId/documents — should list uploaded files (200)', async () => {
    const uploadRes = await request(app)
      .post(`/api/v1/projects/${projectId}/documents`)
      .set('Cookie', cookies)
      .attach('file', Buffer.from('content'), 'test.pdf');

    expect(uploadRes.status).toBe(201);

    const listRes = await request(app)
      .get(`/api/v1/projects/${projectId}/documents`)
      .set('Cookie', cookies);

    expect(listRes.status).toBe(200);
    expect(listRes.body.data.documents.length).toBeGreaterThan(0);
    expect(listRes.body.data.documents[0].originalName).toBe('test.pdf');
  });

  it('POST /projects/:projectId/documents — should return 401 if unauthenticated', async () => {
    (authMiddleware.authenticate as jest.Mock).mockImplementation(
      (_req: any, res: any, _next: any) => {
        res.status(401).json({ error: 'Unauthorized' });
      },
    );

    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/documents`)
      .attach('file', Buffer.from('fake pdf content'), 'test-drawing.pdf');

    expect(res.status).toBe(401);
  });

  it('POST /projects/:projectId/documents — BOLA SECURITY: should return 403 if uploading to another estimators project', async () => {
    const otherEstimatorId = await seedUser('victim@gfs-test.com', 'SecurePass1!', UserRole.ESTIMATOR);
    const otherProjectId = await seedProject(otherEstimatorId);

    const maliciousRes = await request(app)
      .post(`/api/v1/projects/${otherProjectId}/documents`)
      .set('Cookie', cookies)
      .attach('file', Buffer.from('malicious payload'), 'hack.pdf')
      .field('documentType', 'drawing');

    expect(maliciousRes.status).toBe(403);
    expect(maliciousRes.body.error.message).toContain('Only System Admins, Sales Managers, or the assigned Project Estimator');
  });

  it('POST /projects/:projectId/documents — VERSIONING: should correctly replace a document and increment version to 2', async () => {
    const v1Res = await request(app)
      .post(`/api/v1/projects/${projectId}/documents`)
      .set('Cookie', cookies)
      .attach('file', Buffer.from('v1 content'), 'v1-drawing.pdf')
      .field('documentType', 'drawing');

    expect(v1Res.status).toBe(201);
    const v1DocumentId = v1Res.body.data.documents[0].id;
    expect(v1Res.body.data.documents[0].version).toBe(1);


    const v2Res = await request(app)
      .post(`/api/v1/projects/${projectId}/documents`)
      .set('Cookie', cookies)
      .attach('file', Buffer.from('v2 content'), 'v2-drawing.pdf')
      .field('documentType', 'drawing')
      .field('replaceDocumentId', v1DocumentId);

    expect(v2Res.status).toBe(201);
    const v2Doc = v2Res.body.data.documents[0];
    
    expect(v2Doc.version).toBe(2);
    expect(v2Doc.rootDocumentId).toBe(v1DocumentId);
    expect(v2Doc.previousVersionId).toBe(v1DocumentId);
  });

  it('PATCH /documents/:documentId/final-input — should update the final input status (200)', async () => {
    const uploadRes = await request(app)
      .post(`/api/v1/projects/${projectId}/documents`)
      .set('Cookie', cookies)
      .attach('file', Buffer.from('content'), 'spec.pdf')
      .field('documentType', 'spec');
      
    const documentId = uploadRes.body.data.documents[0].id;

    const patchRes = await request(app)
      .patch(`/api/v1/documents/${documentId}/final-input`)
      .set('Cookie', cookies)
      .send({ isFinalInput: true });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.data.document.isFinalInput).toBe(true);
  });

  it('GET /documents/:documentId/download-url — should return a signed Azure URL (200)', async () => {
    const uploadRes = await request(app)
      .post(`/api/v1/projects/${projectId}/documents`)
      .set('Cookie', cookies)
      .attach('file', Buffer.from('content'), 'spec.pdf')
      .field('documentType', 'spec');
      
    const documentId = uploadRes.body.data.documents[0].id;

    const downloadRes = await request(app)
      .get(`/api/v1/documents/${documentId}/download-url`)
      .set('Cookie', cookies);

    expect(downloadRes.status).toBe(200);
    expect(downloadRes.body.data.downloadUrl).toBe('https://fake.blob/download');
  });

  it('DELETE /documents/:documentId — should allow the assigned Estimator to delete a document', async () => {
    const uploadRes = await request(app)
      .post(`/api/v1/projects/${projectId}/documents`)
      .set('Cookie', cookies)
      .attach('file', Buffer.from('content'), 'spec.pdf')
      .field('documentType', 'spec');
      
    const documentId = uploadRes.body.data.documents[0].id;

    const deleteRes = await request(app)
      .delete(`/api/v1/documents/${documentId}`)
      .set('Cookie', cookies);

    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.data.document.isDeleted).toBe(true);
  });

  it('DELETE /documents/:documentId — should allow the assigned Estimator to delete an Outlook document', async () => {
    const uploadRes = await request(app)
      .post(`/api/v1/projects/${projectId}/documents`)
      .set('Cookie', cookies)
      .attach('file', Buffer.from('mail content'), 'mail-attachment.pdf')
      .field('documentType', 'spec')
      .field('metadata', JSON.stringify({ source: 'outlook', emailId: 'email-1' }));

    const documentId = uploadRes.body.data.documents[0].id;

    const deleteRes = await request(app)
      .delete(`/api/v1/documents/${documentId}`)
      .set('Cookie', cookies);

    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.data.document.isDeleted).toBe(true);
  });

  it('POST /documents/:documentId/restore — should restore a recently deleted document', async () => {
    const uploadRes = await request(app)
      .post(`/api/v1/projects/${projectId}/documents`)
      .set('Cookie', cookies)
      .attach('file', Buffer.from('recoverable content'), 'recoverable.pdf')
      .field('documentType', 'spec');

    const documentId = uploadRes.body.data.documents[0].id;

    const deleteRes = await request(app)
      .delete(`/api/v1/documents/${documentId}`)
      .set('Cookie', cookies);

    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.data.document.isDeleted).toBe(true);

    const restoreRes = await request(app)
      .post(`/api/v1/documents/${documentId}/restore`)
      .set('Cookie', cookies);

    expect(restoreRes.status).toBe(200);
    expect(restoreRes.body.data.document.isDeleted).toBe(false);

    const listRes = await request(app)
      .get(`/api/v1/projects/${projectId}/documents`)
      .set('Cookie', cookies);

    expect(listRes.status).toBe(200);
    expect(listRes.body.data.documents.some((document: any) => document.id === documentId)).toBe(true);
  });
});
