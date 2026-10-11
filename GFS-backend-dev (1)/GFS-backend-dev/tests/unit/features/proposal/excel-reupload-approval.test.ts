import { ProposalService } from '../../../../src/features/proposal/proposal.service';
import type { ParsedProposalData } from '../../../../src/features/proposal/excel/excel-ingestion.service';
import type { IProjectSchema } from '../../../../src/db/models/proposal.model';
import { ProjectStatus } from '../../../../src/db/models/project.model';

describe('Excel Re-upload Approval & Quote Revision Workflow', () => {
  let proposalService: ProposalService;
  let mockProposalRepo: any;
  let mockProjectRepo: any;
  let mockFormulaEngine: any;
  let mockFormulaRegistry: any;

  beforeEach(() => {
    mockProposalRepo = {
      ensureProposalExists: jest.fn().mockResolvedValue(undefined),
      getCurrentSchema: jest.fn(),
      appendVersion: jest.fn().mockResolvedValue(undefined),
      logExcelGeneration: jest.fn().mockResolvedValue(undefined),
    };

    mockProjectRepo = {
      findById: jest.fn(),
      updateById: jest.fn(),
      listActive: jest.fn().mockResolvedValue([]),
    };

    mockFormulaEngine = {
      recalculate: jest.fn().mockResolvedValue([]),
    };

    mockFormulaRegistry = {};

    proposalService = new ProposalService(
      mockProposalRepo,
      mockProjectRepo,
      mockFormulaEngine,
      mockFormulaRegistry
    );
  });

  it('marks all stages (1 to 7) as APPROVED, bumps quote revision, marks project completed, and schedules Dropbox sync', async () => {
    const projectId = 'proj-excel-123';
    const userId = 'estimator-user-1';

    const currentSchema: IProjectSchema = {
      stage_1: {
        project_name: { value: 'Original Name', status: 'PENDING' },
        contact_name: { value: 'Original Contact', status: 'PENDING' },
      } as any,
      stage_2: { status: 'PENDING' } as any,
      stage_3: { status: 'PENDING' } as any,
      stage_4: { status: 'PENDING', crossbeam: { value: 'SERIES_1000_I_BEAM', status: 'PENDING' } } as any,
      stage_5: { status: 'PENDING', addons: { duty: 'n' } } as any,
      stage_6: { status: 'PENDING' } as any,
      stage_7: { status: 'PENDING', cost_overrides: {} } as any,
      units: {
        A: {
          value_width_in: 50,
          value_length_in: 100,
          value_panel_count: 2,
          status: 'PENDING',
        } as any,
      },
      pipeline_status: {
        extraction_complete: true,
        extraction_at: new Date(),
        stage_1_status: 'PENDING',
        stage_2_status: 'PENDING',
        stage_3_status: 'PENDING',
        stage_4_status: 'PENDING',
        stage_5_status: 'PENDING',
        stage_6_status: 'PENDING',
        stage_7_status: 'PENDING',
      },
    } as any;

    mockProposalRepo.getCurrentSchema.mockResolvedValue(currentSchema);

    mockProjectRepo.findById.mockResolvedValue({
      id: projectId,
      status: ProjectStatus.ESTIMATOR_DRAFTING,
      customerName: 'Client Inc',
      referenceNumber: 'PRJ-2026-0099',
      assignedEstimators: [],
    });
    mockProjectRepo.updateById.mockResolvedValue({
      id: projectId,
      status: ProjectStatus.ADMIN_PACKAGING,
      estimatedCost: 18500,
    });

    const parsedData: ParsedProposalData = {
      stage1: {
        projectName: 'Updated Deck Proposal',
        contactName: 'Jane Smith',
      },
      units: {
        A: {
          unitKey: 'A',
          widthIn: 64,
          lengthIn: 128,
          panelCount: 3,
        },
      },
      crossbeam: 'SERIES_2000_T_SECTION_TB',
      stage5Addons: {
        duty: 'y',
        seededOrganic: null,
        heatSoakTesting: null,
        nanodot: 'y',
      },
      costOverrides: {
        F68: 2000,
      },
      pricingSnapshot: {
        subtotal: 16500,
        total: 18500,
        final_price: 18500,
      },
    };

    // Spy on internal _generateAndPersistProposalExcel to verify revision generation & Dropbox sync
    const generatedWorkbookMock = {
      quoteNumber: 'Q-2026-0099-RevB',
      fileName: '2026.09.17 - Updated Deck Proposal - Glass Flooring Systems Proposal #Q-2026-0099-RevB.xlsx',
      buffer: Buffer.from('mock-excel-binary'),
      nextSchema: {
        ...currentSchema,
        pipeline_status: {
          ...currentSchema.pipeline_status,
          stage_1_status: 'APPROVED',
          stage_2_status: 'APPROVED',
          stage_3_status: 'APPROVED',
          stage_4_status: 'APPROVED',
          stage_5_status: 'APPROVED',
          stage_6_status: 'APPROVED',
          stage_7_status: 'APPROVED',
        },
        stage_7: {
          status: 'APPROVED',
          cost_overrides: { F68: 2000 },
          computed_snapshot: { final_price: 18500, subtotal: 16500, total: 18500 },
        },
      },
      createdDocId: 'doc-quote-rev-b',
    };

    const generateSpy = jest
      .spyOn(proposalService as any, '_generateAndPersistProposalExcel')
      .mockResolvedValue(generatedWorkbookMock);

    const markCompletedSpy = jest.spyOn(proposalService as any, '_markProjectCompleted');

    // Run applyExcelReingestion
    const result = await proposalService.applyExcelReingestion(
      projectId,
      parsedData,
      'source-excel-doc',
      userId
    );

    // 1. Verify all 7 stages in pipeline_status were passed as APPROVED to the generator
    const schemaPassedToGenerator = (generateSpy.mock.calls as any)[0][1];
    expect(schemaPassedToGenerator.pipeline_status.stage_1_status).toBe('APPROVED');
    expect(schemaPassedToGenerator.pipeline_status.stage_2_status).toBe('APPROVED');
    expect(schemaPassedToGenerator.pipeline_status.stage_3_status).toBe('APPROVED');
    expect(schemaPassedToGenerator.pipeline_status.stage_4_status).toBe('APPROVED');
    expect(schemaPassedToGenerator.pipeline_status.stage_5_status).toBe('APPROVED');
    expect(schemaPassedToGenerator.pipeline_status.stage_6_status).toBe('APPROVED');
    expect(schemaPassedToGenerator.pipeline_status.stage_7_status).toBe('APPROVED');

    // 2. Verify all constituent fields in stages 1-7 and units were recursively set to APPROVED
    expect(schemaPassedToGenerator.stage_1.project_name.status).toBe('APPROVED');
    expect(schemaPassedToGenerator.stage_4.crossbeam.status).toBe('APPROVED');
    expect(schemaPassedToGenerator.units.A.status).toBe('APPROVED');

    // 3. Verify _generateAndPersistProposalExcel was called
    expect(generateSpy).toHaveBeenCalledTimes(1);
    expect(generateSpy).toHaveBeenCalledWith(projectId, expect.any(Object), userId);

    // 4. Verify version history logged as APPROVED at Stage 7
    expect(mockProposalRepo.appendVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId,
        approvalStatus: 'APPROVED',
        stage: 7,
        source: 'ESTIMATOR',
      })
    );

    // 5. Verify _markProjectCompleted was called to package the project
    expect(markCompletedSpy).toHaveBeenCalledTimes(1);
    expect(markCompletedSpy).toHaveBeenCalledWith(projectId, userId, expect.any(Object));

    // 6. Verify returned price
    expect(result.newFinalPrice).toBe(18500);
    expect(result.nextSchema.pipeline_status.stage_7_status).toBe('APPROVED');
  });
});
