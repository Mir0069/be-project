process.env['JWT_SECRET'] = 'test-access-secret';
process.env['JWT_REFRESH_SECRET'] = 'test-refresh-secret';
process.env['QUEUE_PROVIDER'] = 'in_memory';

import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { StatusCodes } from 'http-status-codes';
import { UserRole } from '@db/models/user.model';
import { ProposalService } from '@features/proposal/proposal.service';
import { ProposalController } from '@features/proposal/proposal.controller';
import { authenticate, authorize } from '@features/auth/auth.middleware';
import { requireProjectAccess } from '@shared/middleware/project-access.middleware';
import { errorMiddleware } from '@shared/middleware/error.middleware';
import { AppError } from '@shared/errors/app.error';
import { createEmptySchema } from '@features/proposal/schema-registry';
import { applyPatches } from '@features/proposal/schema-merge.engine';
import type { IProjectSchema } from '@db/models/proposal.model';

// Mock StageTriggerPublisher so ProposalService instantiation does not attempt azure/amqp
jest.mock('@features/proposal/queues/stage-trigger.publisher', () => ({
  StageTriggerPublisher: jest.fn().mockImplementation(() => ({
    publish: jest.fn().mockResolvedValue(undefined),
    publishExtraction: jest.fn().mockResolvedValue(undefined),
  })),
}));

// Mock Project model used by requireProjectAccess param guard
jest.mock('@db/models/project.model', () => {
  const actual = jest.requireActual('@db/models/project.model');
  return {
    ...actual,
    Project: {
      findById: jest.fn(),
    },
  };
});

const { Project } = jest.requireMock('@db/models/project.model');

const JWT_SECRET = process.env['JWT_SECRET'] as string;
const PROJECT_ID = '507f1f77bcf86cd799439011';
const ESTIMATOR_ID = '507f1f77bcf86cd799439012';

const makeToken = (role: UserRole, userId = 'user-123') =>
  jwt.sign({ userId, email: `${role.toLowerCase()}@example.com`, role }, JWT_SECRET, { expiresIn: '1h' });

const buildMockProject = (id = PROJECT_ID) => ({
  id,
  _id: new mongoose.Types.ObjectId(id),
  referenceNumber: 'GFS-2026-1008',
  projectName: '1500 Clinton Street',
  customerName: 'Acme Corp',
  assignedEstimators: [ESTIMATOR_ID],
});

const schemaWithFeedback = (): IProjectSchema => {
  const schema = createEmptySchema();
  schema.stage_1.project_name.value = '1500 CLINTON';
  schema.stage_1.project_name.reasoning = ['Title block explicitly lists the project name.'];
  schema.stage_1.project_name.confidence = 'high';

  const patched = applyPatches(
    schema,
    [
      {
        fieldPath: 'stage_1.project_name',
        value: '1500 Clinton Street',
        feedback: { reasonCode: 'AI_READ_IT_WRONG', note: 'drawing says 96' },
      },
    ],
    { source: 'ESTIMATOR', updatedBy: ESTIMATOR_ID, authorRole: 'ESTIMATOR' },
  ).nextSchema;

  patched.stage_7 = {
    status: 'PENDING',
    cost_overrides: { C10: 130 },
    cost_feedback: {
      C10: [
        {
          reason_code: 'COMPANY_STANDARD',
          note: 'our list price',
          previous_value: 124.32,
          new_value: 130,
          ai_reasoning: null,
          ai_confidence: null,
          author_id: ESTIMATOR_ID,
          author_role: 'ESTIMATOR',
          stage: 7,
          created_at: new Date('2026-09-01T12:00:00.000Z').toISOString(),
        },
      ],
    },
  };

  return patched;
};

describe('GET /api/v1/proposals/:projectId/feedback/export', () => {
  let projectRepo: any;
  let proposalRepo: any;
  let service: ProposalService;
  let controller: ProposalController;
  let app: express.Express;

  beforeEach(() => {
    jest.clearAllMocks();

    projectRepo = {
      findById: jest.fn().mockImplementation(async (id: string) => {
        if (id === PROJECT_ID) return buildMockProject(id);
        return null;
      }),
      updateById: jest.fn().mockResolvedValue({}),
    };

    proposalRepo = {
      findByProjectId: jest.fn().mockImplementation(async (id: string) => {
        if (id === PROJECT_ID) {
          return { projectId: new mongoose.Types.ObjectId(id), schema: schemaWithFeedback() };
        }
        return null;
      }),
      getCurrentSchema: jest.fn().mockImplementation(async (id: string) => {
        if (id === PROJECT_ID) return schemaWithFeedback();
        throw new AppError('Proposal not found', StatusCodes.NOT_FOUND);
      }),
    };

    // Also wire up the Mongoose Project.findById mock for requireProjectAccess middleware
    Project.findById.mockImplementation((id: string) => ({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockImplementation(async () => {
        if (id === PROJECT_ID) return buildMockProject(id);
        return null;
      }),
    }));

    service = new ProposalService(
      proposalRepo,
      projectRepo,
      { recalculate: jest.fn() } as any,
      {} as any,
    );

    controller = new ProposalController(service);

    // Build express router matching proposal.router.ts setup
    const router = express.Router();
    router.use(authenticate);
    router.param('projectId', requireProjectAccess);

    router.get(
      '/:projectId/feedback/export',
      authorize(UserRole.SYSTEM_ADMIN, UserRole.SUPER_ADMIN, UserRole.HEAD_OF_DIVISION),
      controller.exportFeedbackCsv,
    );

    app = express();
    app.use(express.json());
    app.use('/api/v1/proposals', router);
    app.use(errorMiddleware);
  });

  describe('1. Access Control', () => {
    it('allows System Admin to export feedback CSV', async () => {
      const token = makeToken(UserRole.SYSTEM_ADMIN);
      const res = await request(app)
        .get(`/api/v1/proposals/${PROJECT_ID}/feedback/export`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toBe(`attachment; filename="feedback-history-${PROJECT_ID}.csv"`);
    });

    it('allows Super Admin to export feedback CSV', async () => {
      const token = makeToken(UserRole.SUPER_ADMIN);
      const res = await request(app)
        .get(`/api/v1/proposals/${PROJECT_ID}/feedback/export`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toBe(`attachment; filename="feedback-history-${PROJECT_ID}.csv"`);
    });

    it('allows Head of Division to export feedback CSV', async () => {
      const token = makeToken(UserRole.HEAD_OF_DIVISION);
      const res = await request(app)
        .get(`/api/v1/proposals/${PROJECT_ID}/feedback/export`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toBe(`attachment; filename="feedback-history-${PROJECT_ID}.csv"`);
    });

    it('rejects Sales Manager with 403 Forbidden', async () => {
      const token = makeToken(UserRole.SALES_MANAGER);
      const res = await request(app)
        .get(`/api/v1/proposals/${PROJECT_ID}/feedback/export`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain('You do not have permission');
    });

    it('rejects Estimator with 403 Forbidden', async () => {
      const token = makeToken(UserRole.ESTIMATOR, ESTIMATOR_ID);
      const res = await request(app)
        .get(`/api/v1/proposals/${PROJECT_ID}/feedback/export`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain('You do not have permission');
    });

    it('rejects unauthenticated request with 401 Unauthorized', async () => {
      const res = await request(app)
        .get(`/api/v1/proposals/${PROJECT_ID}/feedback/export`);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain('Authentication required');
    });
  });

  describe('2. Data and CSV Response', () => {
    it('returns 200 and formatted CSV for valid projectId with feedback', async () => {
      const token = makeToken(UserRole.SYSTEM_ADMIN);
      const res = await request(app)
        .get(`/api/v1/proposals/${PROJECT_ID}/feedback/export`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toBe(`attachment; filename="feedback-history-${PROJECT_ID}.csv"`);

      const lines = res.text.trim().split('\n');
      expect(lines.length).toBeGreaterThan(1); // Header + at least 1 row

      // First line should be CSV headers
      const headers = lines[0]!;
      expect(headers).toBe(
        'projectReference,projectName,stage,fieldPath,fieldLabel,reasonCode,note,previousValue,newValue,aiReasoning,aiConfidence,changedColumns,authorId,authorRole,createdAt',
      );

      // Verify content contains expected field and cost feedback entries
      expect(res.text).toContain('stage_1.project_name');
      expect(res.text).toContain('AI_READ_IT_WRONG');
      expect(res.text).toContain('drawing says 96');
      expect(res.text).toContain('stage_7.cost_overrides.C10');
      expect(res.text).toContain('COMPANY_STANDARD');
      expect(res.text).toContain('our list price');
    });

    it('returns 200 and valid empty CSV (headers only) for valid projectId with no feedback', async () => {
      proposalRepo.findByProjectId.mockResolvedValueOnce({
        projectId: new mongoose.Types.ObjectId(PROJECT_ID),
        schema: createEmptySchema(),
      });

      const token = makeToken(UserRole.SUPER_ADMIN);
      const res = await request(app)
        .get(`/api/v1/proposals/${PROJECT_ID}/feedback/export`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toBe(`attachment; filename="feedback-history-${PROJECT_ID}.csv"`);

      const lines = res.text.trim().split('\n');
      expect(lines).toHaveLength(1); // Only headers
      expect(lines[0]).toBe(
        'projectReference,projectName,stage,fieldPath,fieldLabel,reasonCode,note,previousValue,newValue,aiReasoning,aiConfidence,changedColumns,authorId,authorRole,createdAt',
      );
    });

    it('returns 200 and valid empty CSV if proposal document does not exist yet', async () => {
      proposalRepo.findByProjectId.mockResolvedValueOnce(null);

      const token = makeToken(UserRole.SYSTEM_ADMIN);
      const res = await request(app)
        .get(`/api/v1/proposals/${PROJECT_ID}/feedback/export`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      const lines = res.text.trim().split('\n');
      expect(lines).toHaveLength(1);
    });

    it('returns 404 for invalid/non-existent projectId', async () => {
      const nonExistentId = '507f1f77bcf86cd799439099';
      const token = makeToken(UserRole.SYSTEM_ADMIN);

      const res = await request(app)
        .get(`/api/v1/proposals/${nonExistentId}/feedback/export`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toBe('Project not found');
    });
  });

  describe('3. ProposalService.exportFeedbackCsv unit tests', () => {
    it('throws 404 when project does not exist', async () => {
      projectRepo.findById.mockResolvedValueOnce(null);

      await expect(service.exportFeedbackCsv('missing-id')).rejects.toThrow(
        new AppError('Project not found', StatusCodes.NOT_FOUND),
      );
    });

    it('handles CastError from repository by throwing 404', async () => {
      const castError = new mongoose.Error.CastError('ObjectId', 'bad-id', 'projectId');
      projectRepo.findById.mockRejectedValueOnce(castError);

      await expect(service.exportFeedbackCsv('bad-id')).rejects.toThrow(
        new AppError('Project not found', StatusCodes.NOT_FOUND),
      );
    });

    it('returns CSV with all feedback rows for existing project with feedback', async () => {
      const csv = await service.exportFeedbackCsv(PROJECT_ID);

      const lines = csv.trim().split('\n');
      expect(lines.length).toBe(3); // Header + 2 feedback entries (stage_1 + stage_7)
      expect(csv).toContain('GFS-2026-1008');
      expect(csv).toContain('1500 Clinton Street');
      expect(csv).toContain('AI_READ_IT_WRONG');
      expect(csv).toContain('COMPANY_STANDARD');
    });
  });
});
