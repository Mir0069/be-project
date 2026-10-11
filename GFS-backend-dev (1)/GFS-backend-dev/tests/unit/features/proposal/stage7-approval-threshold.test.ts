// =============================================================================
// STAGE 7 APPROVAL — THRESHOLD MUST INCLUDE OPTIONAL ADD-ONS
// =============================================================================
//
// The $50K approval threshold must match `computeProposalPrice`'s grand total
// (final price + any ACCEPTED optional add-ons — see `calculateFinalParameters`),
// not the narrower `finalPrice` alone. This schema/cost-overrides fixture is
// lifted from final-parameters.calculator.test.ts, where it's proven to
// produce finalPrice=48699.95 (under $50K); marking C107/C110 ACCEPTED adds
// 11880 on top (over $50K once combined) — exactly the reported bug scenario.

jest.mock('@repositories/index', () => ({
  userRepository: { findById: jest.fn() },
}));

jest.mock('@features/notifications/notification.router', () => ({
  notificationService: {
    notifyStage7ApprovalRequested: jest.fn(),
    resolveStage7ApprovalRequests: jest.fn(),
  },
}));

import { createEmptySchema } from '../../../../src/features/proposal/schema-registry';
import { ProposalService } from '../../../../src/features/proposal/proposal.service';
import { userRepository } from '@repositories/index';

const findByIdMock = userRepository.findById as jest.Mock;

const field = (value: unknown) => ({ value, status: 'APPROVED' });

const buildOverPriceThresholdSchema = (): any => {
  const schema: any = createEmptySchema();
  schema.stage_2.glass_type = field('GLASS_NO_IGU');
  schema.stage_3.decision.frame_type = field('PERIMETER_NON_TB');
  schema.stage_4.crossbeam = field('SERIES_1000_I_BEAM');
  schema.stage_4.takeoff.panel_count = field(6);
  schema.stage_4.takeoff.packaging = field(2);
  schema.stage_5.calculated.silicone_tubes = field(14);
  schema.stage_5.calculated.total_man_hours = field(28);
  schema.stage_5.addons.duty = field('y');
  schema.stage_5.addons.seeded_organic = field('y');
  schema.stage_5.addons.heat_soak_testing = field('n');
  schema.stage_5.addons.nanodot = field('y');
  schema.units.A = {
    ...schema.units.A,
    status: 'APPROVED',
    value_width_in: 60,
    value_length_in: 432,
    value_panel_count: 6,
    value_num_units: 1,
    value_vertical_rafter_count: 5,
    value_horizontal_rafter_count: 0,
  };
  schema.stage_7 = {
    status: 'READY',
    cost_overrides: {
      C9: 76, C40: 32.649435, C56: 40.773915, C61: 0.1, C62: 20, C63: 9, C64: 18,
      C66: 3, C67: 3, C71: 68, C72: 31, C73: 150, C86: 0.1, C87: 0.6, C88: 0.06,
      C90: 0.15, C107: 10, C109: 7.5, C110: 56,
    },
    // Grand total only includes an optional add-on once the customer has
    // ACCEPTED it (see getOptionalAddOnStatuses) — merely selecting it on
    // Stage 5 leaves it "pending acceptance" and out of the threshold total.
    optional_add_on_statuses: { C107: 'ACCEPTED', C109: 'NOT_SELECTED', C110: 'ACCEPTED' },
  };
  schema.pipeline_status.stage_1_status = 'APPROVED';
  schema.pipeline_status.stage_2_status = 'APPROVED';
  schema.pipeline_status.stage_3_status = 'APPROVED';
  schema.pipeline_status.stage_4_status = 'APPROVED';
  schema.pipeline_status.stage_5_status = 'APPROVED';
  schema.pipeline_status.stage_6_status = 'APPROVED';
  return schema;
};

const buildProposalRepo = (schema: any) => ({
  getCurrentSchema: jest.fn().mockResolvedValue(schema),
  appendVersion: jest.fn().mockResolvedValue(undefined),
});

const projectId = '507f1f77bcf86cd799439011';
const estimatorId = '507f1f77bcf86cd799439012';
const salesManagerId = '507f1f77bcf86cd799439099';

const buildProjectRepo = () => ({
  findById: jest.fn().mockResolvedValue({
    id: projectId,
    referenceNumber: 'GFS-2026-1099',
    projectName: 'Threshold Test',
    assignedEstimators: [estimatorId],
  }),
  updateById: jest.fn().mockResolvedValue({ id: projectId }),
});

const buildService = (proposalRepo: any, projectRepo: any) =>
  new ProposalService(proposalRepo, projectRepo, { recalculate: jest.fn() } as any, {} as any);

describe('Stage 7 approval threshold includes optional add-ons', () => {
  beforeEach(() => {
    findByIdMock.mockReset();
  });

  it('getStage7ApprovalContext reports the grand total (final price + optional add-ons), not the pre-add-on final price alone', async () => {
    const schema = buildOverPriceThresholdSchema();
    const service = buildService(buildProposalRepo(schema), buildProjectRepo());

    const { finalPrice } = await service.getStage7ApprovalContext(projectId, estimatorId, 'ESTIMATOR');

    // 48699.95 (pre-add-on) + 11880 (C107/C110 optional add-ons) = 60579.95
    expect(finalPrice).toBe(60579.95);
    expect(finalPrice).toBeGreaterThan(50000);
  });

  it('assignStage7Approver rejects a non-named Sales Manager once optional add-ons push the total over $50K', async () => {
    const schema = buildOverPriceThresholdSchema();
    const service = buildService(buildProposalRepo(schema), buildProjectRepo());

    findByIdMock.mockResolvedValue({
      id: salesManagerId,
      email: 'random.sales.manager@gfs.com',
      role: 'SALES_MANAGER',
      isActive: true,
      firstName: 'Random',
      lastName: 'Manager',
    });

    await expect(
      service.assignStage7Approver(projectId, salesManagerId, estimatorId, 'ESTIMATOR'),
    ).rejects.toThrow(/high-value threshold/i);
  });

  it('assignStage7Approver allows a named approver once optional add-ons push the total over $50K', async () => {
    const schema = buildOverPriceThresholdSchema();
    const service = buildService(buildProposalRepo(schema), buildProjectRepo());

    findByIdMock.mockImplementation((id: string) =>
      Promise.resolve(
        id === salesManagerId
          ? {
              id: salesManagerId,
              email: 'wayne@glassflooringsystems.com',
              role: 'SALES_MANAGER',
              isActive: true,
              firstName: 'Wayne',
              lastName: 'Conklin',
            }
          : { id, email: 'estimator@gfs.com', role: 'ESTIMATOR', isActive: true, firstName: 'Est', lastName: 'Imator' },
      ),
    );

    const approval = await service.assignStage7Approver(projectId, salesManagerId, estimatorId, 'ESTIMATOR');
    expect(approval.approverEmail).toBe('wayne@glassflooringsystems.com');
  });

  it('does not create another request when the active approver and price are unchanged', async () => {
    const schema = buildOverPriceThresholdSchema();
    schema.stage_7.approval = {
      approverId: salesManagerId,
      approverName: 'Dan Muniz',
      approverEmail: 'dan@example.com',
      assignedBy: estimatorId,
      assignedAt: new Date('2026-09-25T00:00:00.000Z'),
      approvedBy: null,
      approvedByName: null,
      approvedAt: null,
      priceAtAssignment: 60579.95,
    };
    const proposalRepo = buildProposalRepo(schema);
    const service = buildService(proposalRepo, buildProjectRepo());

    const approval = await service.assignStage7Approver(projectId, salesManagerId, estimatorId, 'ESTIMATOR');

    expect(approval).toBe(schema.stage_7.approval);
    expect(proposalRepo.appendVersion).not.toHaveBeenCalled();
    expect(findByIdMock).not.toHaveBeenCalled();
  });
});
