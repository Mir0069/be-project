import request from 'supertest';
import { app } from '../../src/app';

/**
 * Guards the API's auth boundary.
 *
 * `pending-approval.router` is mounted at the bare `/api/v1` root. It used to
 * call `router.use(authenticate)` with no path, which runs for EVERY request
 * reaching that router, so it gated every route mounted after it and turned
 * unknown URLs into 401s. That silently broke the AI webhooks, which hold no
 * cookie. These tests fail if a pathless guard is ever reintroduced there.
 */
describe('API auth boundaries', () => {
  describe('routes that must NOT be gated', () => {
    it('returns 404, not 401, for an unknown path under /api/v1', async () => {
      const res = await request(app).get('/api/v1/this-route-does-not-exist');
      expect(res.status).toBe(404);
    });

    it('lets the AI extraction-result webhook through without a cookie', async () => {
      const res = await request(app).post('/api/v1/webhooks/ai-extraction-result/abc').send({});
      expect(res.status).not.toBe(401);
    });

  });

  describe('the CRM context write-back stays off', () => {
    // crm-context-webhook.router exists but is deliberately not mounted: it is an
    // unauthenticated PUT that overwrites a project's description by id. Zoho is
    // the source of that field and the sync already writes it, so exposing the
    // write buys nothing. This fails if someone mounts it without adding auth.
    it('is not reachable', async () => {
      const res = await request(app)
        .put('/api/v1/crm-context/6a7ec8f861d55e051e63e19a')
        .send({ description: 'from the AI' });
      expect(res.status).toBe(404);
    });
  });

  describe('routes that MUST stay gated', () => {
    it('still requires auth to read a pending approval', async () => {
      const res = await request(app).get('/api/v1/pending-approvals/abc');
      expect(res.status).toBe(401);
    });

    it('still requires auth to list a project\'s pending approvals', async () => {
      const res = await request(app).get('/api/v1/projects/abc/pending-approvals');
      expect(res.status).toBe(401);
    });

    it('still requires auth to approve a change', async () => {
      const res = await request(app).post('/api/v1/pending-approvals/abc/approve').send({});
      expect(res.status).toBe(401);
    });

    it('still requires auth to reject a change', async () => {
      const res = await request(app).post('/api/v1/pending-approvals/abc/reject').send({});
      expect(res.status).toBe(401);
    });

    it('still requires auth to manually re-trigger', async () => {
      const res = await request(app).post('/api/v1/projects/abc/manual-retrigger').send({});
      expect(res.status).toBe(401);
    });

    it('still requires auth on a route mounted after the pending-approval router', async () => {
      const res = await request(app).get('/api/v1/notifications');
      expect(res.status).toBe(401);
    });

    it('requires auth to read audit logs', async () => {
      const res = await request(app).get('/api/v1/audit-logs');
      expect(res.status).toBe(401);
    });
  });
});
