import { isEligibleApprover } from '../../../../src/features/proposal/stage7-approval.rules';

const cfg = {
  highValueThreshold: 50000,
  highValueApproverEmails: ['greg@glassflooringsystems.com', 'greg@gfs.com', 'wayne@glassflooringsystems.com'],
};

const salesManager = (overrides: Partial<{ role: string; email: string; isActive: boolean }> = {}) => ({
  role: 'SALES_MANAGER',
  email: 'sales@gfs.com',
  isActive: true,
  ...overrides,
});

describe('isEligibleApprover', () => {
  it('allows any active Sales Manager at or below the threshold', () => {
    expect(isEligibleApprover(salesManager(), 50000, cfg)).toBe(true);
    expect(isEligibleApprover(salesManager(), 1000, cfg)).toBe(true);
  });

  it('allows any active Sales Manager when price is null/undefined', () => {
    expect(isEligibleApprover(salesManager(), null, cfg)).toBe(true);
    expect(isEligibleApprover(salesManager(), undefined, cfg)).toBe(true);
  });

  it('rejects a non-named Sales Manager above the threshold', () => {
    expect(isEligibleApprover(salesManager(), 50000.01, cfg)).toBe(false);
    expect(isEligibleApprover(salesManager(), 75000, cfg)).toBe(false);
  });

  it('allows named approvers above the threshold, case-insensitively', () => {
    expect(isEligibleApprover(salesManager({ email: 'Greg@GlassFlooringSystems.com' }), 75000, cfg)).toBe(true);
    expect(isEligibleApprover(salesManager({ email: 'greg@gfs.com' }), 75000, cfg)).toBe(true);
    expect(isEligibleApprover(salesManager({ email: 'wayne@glassflooringsystems.com' }), 75000, cfg)).toBe(true);
  });

  it('rejects inactive users regardless of role or price', () => {
    expect(isEligibleApprover(salesManager({ isActive: false }), 1000, cfg)).toBe(false);
    expect(isEligibleApprover(salesManager({ isActive: false, email: 'wayne@glassflooringsystems.com' }), 75000, cfg)).toBe(false);
  });

  it('rejects non-Sales-Manager roles', () => {
    expect(isEligibleApprover(salesManager({ role: 'ESTIMATOR' }), 1000, cfg)).toBe(false);
    expect(isEligibleApprover(salesManager({ role: 'ESTIMATOR', email: 'wayne@glassflooringsystems.com' }), 75000, cfg)).toBe(false);
  });

  it('allows a Head of Division (inherits Sales Manager) the same as a Sales Manager', () => {
    expect(isEligibleApprover(salesManager({ role: 'HEAD_OF_DIVISION' }), 1000, cfg)).toBe(true);
    expect(isEligibleApprover(salesManager({ role: 'HEAD_OF_DIVISION' }), 75000, cfg)).toBe(false);
  });
});
