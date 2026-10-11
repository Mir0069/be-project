import {
  normalizeAiConfidence,
  PendingApprovalService,
} from '@features/proposal/pending-approval.service';

describe('AI confidence normalization', () => {
  it('converts percentage confidence to the persisted 0-1 scale', () => {
    expect(normalizeAiConfidence(98)).toBe(0.98);
    expect(normalizeAiConfidence('75')).toBe(0.75);
  });

  it('preserves decimal confidence and clamps out-of-range values', () => {
    expect(normalizeAiConfidence(0.87)).toBe(0.87);
    expect(normalizeAiConfidence(-1)).toBe(0);
    expect(normalizeAiConfidence(150)).toBe(1);
  });

  it('uses a safe default for missing or invalid confidence', () => {
    expect(normalizeAiConfidence(undefined)).toBe(0.5);
    expect(normalizeAiConfidence('not-a-number')).toBe(0.5);
  });

  it('normalizes confidence before creating a pending approval record', async () => {
    const pendingApprovalRepo = {
      findByCorrelationId: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(async (input) => input),
    };
    const proposalRepo = {
      getCurrentSchema: jest.fn().mockResolvedValue({}),
    };
    const service = new PendingApprovalService(
      pendingApprovalRepo as any,
      proposalRepo as any,
      {} as any,
    );

    await service.createPendingApproval({
      projectId: 'project-1',
      source: 'EMAIL' as any,
      sourceId: 'email-1',
      correlationId: 'outlookEmail:email-1',
      documentIds: [],
      documentNames: [],
      newExtractedData: {},
      aiReasoning: 'AI result received',
      aiConfidence: 98,
    });

    expect(pendingApprovalRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ confidence: 0.98 }),
    );
  });
});
