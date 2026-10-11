// =============================================================================
// PENDING APPROVAL — WHO MAY ACCEPT OR REJECT A RETRIGGER
// =============================================================================
// The three write routes carried a role list that omitted SALES_MANAGER while
// their own comments said sales managers were allowed, so every manager got a
// flat 403 from the UI's Approve / Reject buttons. These tests drive the real
// router with the real authorize() middleware and only stub authentication, so
// the role list itself is what is under test.

process.env['JWT_SECRET'] = 'test-access-secret';
process.env['JWT_REFRESH_SECRET'] = 'test-refresh-secret';
process.env['QUEUE_PROVIDER'] = 'in_memory';

import express from 'express';
import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';
import { UserRole } from '@db/models/user.model';
import * as authMiddleware from '@features/auth/auth.middleware';

jest.mock('@features/auth/auth.middleware', () => {
  const original = jest.requireActual('@features/auth/auth.middleware');
  return { ...original, authenticate: jest.fn() };
});

// The router module instantiates repositories and the proposal service at
// import time; none of that is exercised here because the controller is a stub.
import { createPendingApprovalRouter } from '@features/proposal/pending-approval.router';

const authenticateMock = authMiddleware.authenticate as unknown as jest.Mock;

/** Records which handler ran so a 200 cannot be mistaken for a skipped route. */
const controller = {
  getPendingApprovals: (_req: Request, res: Response) => res.status(200).json({ ok: 'list' }),
  getPendingCount: (_req: Request, res: Response) => res.status(200).json({ ok: 'count' }),
  getPendingApproval: (_req: Request, res: Response) => res.status(200).json({ ok: 'one' }),
  approveChange: (_req: Request, res: Response) => res.status(200).json({ ok: 'approved' }),
  rejectChange: (_req: Request, res: Response) => res.status(200).json({ ok: 'rejected' }),
  manualRetrigger: (_req: Request, res: Response) => res.status(200).json({ ok: 'retriggered' }),
};

const appAs = (role: UserRole | null) => {
  authenticateMock.mockImplementation((req: Request, _res: Response, next: NextFunction) => {
    if (role) (req as any).user = { userId: 'user-1', role };
    next();
  });

  const app = express();
  app.use(express.json());
  app.use('/api/v1', createPendingApprovalRouter(controller as any));
  // Mirrors the production error handler closely enough to surface the status.
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    res.status(err?.statusCode ?? 500).json({ message: err?.message });
  });
  return app;
};

const WRITE_ROUTES: Array<[string, string]> = [
  ['approve', '/api/v1/pending-approvals/abc123/approve'],
  ['reject', '/api/v1/pending-approvals/abc123/reject'],
  ['manual retrigger', '/api/v1/projects/proj-1/manual-retrigger'],
];

describe('pending approval route authorization', () => {
  beforeEach(() => jest.clearAllMocks());

  describe.each(WRITE_ROUTES)('%s', (_label, path) => {
    it('lets a SALES_MANAGER through', async () => {
      const res = await request(appAs(UserRole.SALES_MANAGER)).post(path).send({});
      expect(res.status).toBe(200);
    });

    it.each([UserRole.ESTIMATOR, UserRole.SYSTEM_ADMIN, UserRole.SUPER_ADMIN, UserRole.HEAD_OF_DIVISION])(
      'still lets a %s through',
      async (role) => {
        const res = await request(appAs(role)).post(path).send({});
        expect(res.status).toBe(200);
      },
    );

    it('rejects an unauthenticated caller with 403', async () => {
      const res = await request(appAs(null)).post(path).send({});
      expect(res.status).toBe(403);
    });
  });

  it('keeps the read routes open to any authenticated role', async () => {
    const res = await request(appAs(UserRole.SALES_MANAGER)).get(
      '/api/v1/projects/proj-1/pending-approvals',
    );
    expect(res.status).toBe(200);
  });
});
