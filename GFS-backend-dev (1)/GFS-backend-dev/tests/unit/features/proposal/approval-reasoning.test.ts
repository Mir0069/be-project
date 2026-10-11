import { latestApprovalReasoning } from '../../../../src/features/proposal/approval-reasoning';

const approvalsReturning = (approval: unknown) => {
  const exec = jest.fn().mockResolvedValue(approval);
  const sort = jest.fn().mockReturnValue({ lean: () => ({ exec }) });
  const findOne = jest.fn().mockReturnValue({ sort });
  return { findOne, sort };
};

describe('latestApprovalReasoning', () => {
  it('skips Zoho approvals, whose text is the raw note, and takes the newest other one', async () => {
    const approvals = approvalsReturning({ reasoning: 'Customer asked for IGU glass in the latest email.' });

    await expect(latestApprovalReasoning(approvals, 'p1')).resolves.toBe('Customer asked for IGU glass in the latest email.');
    expect(approvals.findOne).toHaveBeenCalledWith({ projectId: 'p1', source: { $nin: ['ZOHO'] } });
    expect(approvals.sort).toHaveBeenCalledWith({ createdAt: -1 });
  });

  it('returns nothing when no approval carries reasoning', async () => {
    await expect(latestApprovalReasoning(approvalsReturning(null), 'p1')).resolves.toBeUndefined();
    await expect(latestApprovalReasoning(approvalsReturning({ reasoning: '' }), 'p1')).resolves.toBeUndefined();
  });
});
