import mongoose from 'mongoose';

import { env } from '@config/index';
import { ZohoTokenModel } from '@db/models/zoho-token.model';
import { MongooseZohoTokenRepository } from '@repositories/mongoose/zoho-token.repository';
import { ZohoService } from '@features/zoho/zoho.service';

const RUN_INTEGRATION = process.env['ZOHO_INTEGRATION_TESTS'] === '1';
const TEST_MODULE = process.env['ZOHO_TEST_MODULE'] ?? 'Leads';
const describeIntegration = RUN_INTEGRATION ? describe : describe.skip;

describeIntegration('zoho integration (live API)', () => {
  let zohoService: ZohoService;

  beforeAll(async () => {
    await mongoose.connect(env.db.mongoUri);

    const existing = await ZohoTokenModel.findOne({ accountKey: 'default' }).lean();
    if (!existing) {
      throw new Error(
        'No stored Zoho token. Authorize once via GET /api/v1/zoho/auth before running integration tests.',
      );
    }

    zohoService = new ZohoService(new MongooseZohoTokenRepository());
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  it('fetches a page of records from a real Zoho module', async () => {
    const result = await zohoService.fetchFromZoho<{ data?: unknown[] }>(
      `/crm/v2/${TEST_MODULE}`,
      { per_page: '1' },
    );

    expect(result).toBeDefined();
    if (result.data) {
      expect(Array.isArray(result.data)).toBe(true);
    }
  });

  it('inserts a record into Zoho and the response reports success', async () => {
    const payload = {
      data: [
        {
          Last_Name: `GFS-Test-${Date.now()}`,
          First_Name: 'Automated',
          Email: `gfs-test-${Date.now()}@example.com`,
          Company: 'GFS Backend Tests',
        },
      ],
      trigger: [],
    };

    const result = await zohoService.insertIntoZoho<{
      data: Array<{ status: string; code: string; details?: { id?: string } }>;
    }>(`/crm/v2/${TEST_MODULE}`, payload);

    expect(Array.isArray(result.data)).toBe(true);
    const first = result.data[0];
    expect(first?.status).toBe('success');
    expect(first?.code).toBe('SUCCESS');
    expect(first?.details?.id).toBeDefined();
  });

  it('refreshes an expired access token transparently on next call', async () => {
    await ZohoTokenModel.updateOne(
      { accountKey: 'default' },
      { $set: { expiresAt: new Date(Date.now() - 60 * 1000) } },
    );

    const token = await zohoService.getValidAccessToken();
    expect(token.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});
