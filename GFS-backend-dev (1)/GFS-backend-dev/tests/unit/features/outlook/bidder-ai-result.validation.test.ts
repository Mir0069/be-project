import { aiResultSchema } from '@features/outlook/outlook.validation';

describe('bidder AI result validation', () => {
  it('preserves competitive bidder and classified address metadata', () => {
    const payload = {
      body: {
        correlationId: 'sb-msg-test-multibidder-001',
        action: 'CREATE',
        proposed: {
          isProject: true,
          projectName: '456 Oak Avenue',
          companyName: 'XYZ Builders',
          groupId: '40cadd8414bd2405',
          isCompetitiveBid: true,
          allBidders: [
            { email: 'mike@xyzbuilders.com', company: 'XYZ Builders', isPrimary: true },
            { email: 'tom@epsilonbuilds.com', company: 'Epsilon Builds', isPrimary: false },
          ],
          primaryBidderEmail: 'mike@xyzbuilders.com',
          allAddresses: [
            { address: '456 Oak Avenue', type: 'INSTALLATION' },
            { address: '400 Wall Street', type: 'BILLING' },
          ],
        },
      },
    };

    const parsed = aiResultSchema.parse(payload);

    expect(parsed.body.proposed?.allBidders).toHaveLength(2);
    expect(parsed.body.proposed?.allAddresses?.[0]?.type).toBe('INSTALLATION');
    expect(parsed.body.proposed?.groupId).toBe('40cadd8414bd2405');
  });

  it('rejects invalid bidder email addresses', () => {
    expect(() => aiResultSchema.parse({
      body: {
        correlationId: 'invalid-bidder',
        action: 'CREATE',
        proposed: {
          isProject: true,
          allBidders: [{ email: 'not-an-email' }],
        },
      },
    })).toThrow();
  });
});
