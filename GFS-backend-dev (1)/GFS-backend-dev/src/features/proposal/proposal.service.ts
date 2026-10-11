// =============================================================================
// PROPOSAL MODULE — SERVICE
// =============================================================================

import {
  calculateFinalParameters,
  getOptionalAddOnStatuses,
  OPTIONAL_ADD_ON_CELLS,
} from './final-parameters.calculator';
import { StatusCodes } from 'http-status-codes';
import { AppError } from '@shared/errors/app.error';
import { ErrorCode } from '@shared/errors/error-codes';
import { hasAnyRole } from '@shared/security/role-access';
import { proposalEventBus, ProposalEvent } from './proposal.events';
import type { IProposalRepository } from '@repositories/interfaces/i-proposal.repository';
import type { IDomainProject, IProjectRepository } from '@repositories/interfaces/i-project.repository';
import {
  deriveLeadApproval,
  type LeadApproval,
  type ZohoLeadStatusService,
} from '@features/zoho/zoho-lead-status.service';

/** Narrow slice of ZohoLeadStatusService, so this service is trivial to fake in tests. */
export type LeadStatusMarker = Pick<ZohoLeadStatusService, 'markQuotedNeedsFollowUp'>;
import {
  generateProposalExcelWithFallback,
  loadTemplateBuffer,
  parseParameterValue,
  extractComputedProposalCells,
  buildProposalUnitCells,
  hasRealUnitData,
  convertProposalSheetToPdf,
  findAddonSectionUnitRowBases,
  isAddonSectionRowAddress,
} from './excel/graph.generator';
import { extractPricingSnapshot } from './excel/pricing-snapshot';
import { excelIngestionService, type ParsedProposalData } from './excel/excel-ingestion.service';
import ExcelJS from 'exceljs';
import { FormulaEngineService } from './formula-engine/formula-engine.service';
import { QuoteNumberingService } from './quote-numbering/quote-numbering.service';
import { applyPatches, FieldPatch } from './schema-merge.engine';
import { normalizePhoneValue } from '@shared/utils/phone-values';
import { buildFeedbackEntry, capEntries } from './feedback';
import { collectFeedbackRows, toCsv } from './feedback-export';
import { StageTriggerPublisher } from './queues/stage-trigger.publisher';
import { PipelineTrigger } from './pipeline-triggers';
import mongoose from 'mongoose';
import { notificationService } from '@features/notifications/notification.router';
import type { BlobStorage } from '@features/document-ingestion/document-ingestion.types';
import { ProjectAnalysisStatus, ProjectStatus } from '@db/models/project.model';
import {
  getFieldDefinition,
  getUnitFieldDefinitions,
  isResolvedCrossbeamValue,
  isResolvedGlassValue,
} from './schema-registry';
import {
  MULTI_UNIT_FRAME_TYPES,
  MULTI_UNIT_GLASS_TYPES,
  dropInvalidUnitFields,
} from './multi-unit.contract';
import {
  dropFrameDerivedFields,
  frameFamilyOf,
  hasCitedStatedFrameFamily,
  instructionNamesFrameFamily,
  isCanonicalFrameType,
} from './frame-family';
import { partitionAiDocuments, type ExtractionDocumentScope } from './ai-document-selection';
import { buildActiveRetrigger, liveRetriggerInstruction } from './retrigger-instruction';
import { singleUnitSpecPatches, syncSingleUnitSpecsFromProject } from './single-unit-sync';
import { latestApprovalReasoning } from './approval-reasoning';
import { latestChangedNote } from '@features/zoho/changed-note';
import {
  isRealDescription,
  isUnitFieldHumanHeld,
  resolveUnitDescription,
  resolveUnitManHours,
  resolveUnitPackaging,
  toFiniteNumber,
  unitKeyForDescriptionCell,
  unitKeyForManHoursCell,
  unitKeyForPackagingCell,
} from './unit-derived-values';
import { isUnitQuantityOverrideKey } from './unit-pricing-lines';

import crypto from 'crypto';
import { DocumentModel, DocumentTypeTag } from '@db/models/document.model';
import { dropboxSyncService } from '@features/projects/dropbox-sync.service';

import type { WorkflowStage, IProjectSchema, OptionalAddOnStatus } from '@db/models/proposal.model';
import type {
  ProposalTimelineItem,
  ProposalTimelineResponse,
  ProposalSendReadiness,
  QuotationHistoryItem,
  ProposalTimelineEvent,
  TimelineItemStatus,
} from './proposal.types';
import type { AuditLogService } from '@features/audit-logs/audit-logs.service';
import { AuditLogCategory, AuditLogSource, AuditLogVisibility } from '@features/audit-logs/audit-logs.types';
import { userRepository } from '@repositories/index';
import { isEligibleApprover } from './stage7-approval.rules';
import { env } from '@config/index';

const ADDITIONAL_CHARGE_CELLS = [
  'C75', 'C76', 'C77', 'C78', 'C79', 'C80', 'C81', 'C82',
  'C69', 'C85', 'C89', 'C91', 'C93', 'C94',
] as const;
const DEFAULT_ADDITIONAL_CHARGE_SELECTIONS: Record<string, 'Y' | 'N'> = Object.fromEntries(
  ADDITIONAL_CHARGE_CELLS.map((cell) => [cell, 'N']),
) as Record<string, 'Y' | 'N'>;

export const PROPOSAL_ENGINE_VERSION = '2026.09.10.v4';
export const PROPOSAL_ENGINE_CUTOFF_MS = Date.parse('2026-09-10T05:30:00.000Z');

export class ProposalService {
  private readonly triggerPublisher: StageTriggerPublisher;
  private readonly quoteNumberingService: QuoteNumberingService;

  /**
   * A project-level Stage 2/3 result is safe to use for a take-off row only
   * when there is exactly one real unit. Multi-unit projects intentionally
   * receive no default because their units may have different specifications.
   */
  private _getSingleUnitProjectDefaults(schema: IProjectSchema): {
    key: string;
    values: Partial<Record<'value_frame_type' | 'value_glass_type', string>>;
  } | null {
    const activeUnits = Object.entries(schema.units ?? {}).filter(([_, unit]) => hasRealUnitData(unit));
    if (activeUnits.length !== 1) return null;

    const [key, unit] = activeUnits[0] as [string, any];
    const overriddenFields = new Set<string>(unit?._meta?.human_override_fields ?? []);
    const glass = schema.stage_2?.glass_type?.value;
    const frame = schema.stage_3?.decision?.frame_type?.value;
    const values: Partial<Record<'value_frame_type' | 'value_glass_type', string>> = {};

    if (
      unit.value_glass_type == null &&
      !overriddenFields.has('value_glass_type') &&
      typeof glass === 'string' &&
      (MULTI_UNIT_GLASS_TYPES as readonly string[]).includes(glass)
    ) {
      values.value_glass_type = glass;
    }

    if (
      unit.value_frame_type == null &&
      !overriddenFields.has('value_frame_type') &&
      typeof frame === 'string' &&
      (MULTI_UNIT_FRAME_TYPES as readonly string[]).includes(frame)
    ) {
      values.value_frame_type = frame;
    }

    return Object.keys(values).length > 0 ? { key, values } : null;
  }

  private _applySingleUnitProjectDefaults(schema: IProjectSchema): string[] {
    const defaults = this._getSingleUnitProjectDefaults(schema);
    if (!defaults) return [];

    const unit = schema.units[defaults.key]!;
    Object.assign(unit, defaults.values, {
      updated_at: new Date(),
      updated_by: 'system',
    });

    return Object.keys(defaults.values).map((field) => `units.${defaults.key}.${field}`);
  }

  constructor(
    private readonly proposalRepo: IProposalRepository,
    private readonly projectRepo: IProjectRepository,
    private readonly formulaEngine: FormulaEngineService,
    private readonly blobStorage: BlobStorage,
    // Optional: only the proposal-approve endpoint needs it, so existing
    // constructions (scripts, tests) stay valid.
    private readonly leadStatus?: LeadStatusMarker,
    private readonly auditLogService?: Pick<AuditLogService, 'recordBestEffort'>,
  ) {
    this.triggerPublisher = new StageTriggerPublisher();
    this.quoteNumberingService = new QuoteNumberingService(this.projectRepo);
  }

  /**
   * Promote a project only after the final estimator stage is approved and a
   * proposal workbook has been generated successfully. AI extraction is a
   * readiness milestone, not project completion.
   */
  private async _markProjectCompleted(
    projectId: string,
    completedBy: string,
    schema?: IProjectSchema,
  ): Promise<void> {
    const currentSchema = schema ?? await this.proposalRepo.getCurrentSchema(projectId);
    const isStage7Approved =
      currentSchema?.pipeline_status?.stage_7_status === 'APPROVED' ||
      currentSchema?.stage_7?.status === 'APPROVED';
    if (!isStage7Approved) return;

    const project = await this.projectRepo.findById(projectId);
    if (!project) throw new AppError('Project not found', StatusCodes.NOT_FOUND);
    const finalPrice = this.computeProposalPrice(currentSchema);
    const updatePayload: any = {
      status: ProjectStatus.ADMIN_PACKAGING,
      analysisStatus: ProjectAnalysisStatus.COMPLETED,
      revisionRequest: null,
    };
    if (finalPrice && finalPrice > 0) {
      updatePayload.estimatedCost = finalPrice;
    }

    const updatedProject = await this.projectRepo.updateById(projectId, updatePayload);
    if (!updatedProject) throw new AppError('Project not found', StatusCodes.NOT_FOUND);

    try {
      const estimatorIds = (project.assignedEstimators ?? [])
        .map((estimator: any) => estimator?.id || estimator?._id || estimator)
        .filter(Boolean)
        .map((id: any) => String(id))
        .filter((id: string) => mongoose.Types.ObjectId.isValid(id));

      await notificationService.notifyProjectCompleted({
        projectId,
        referenceNumber: project.referenceNumber,
        projectName: project.projectName,
        estimatorIds,
      });
    } catch (notifErr) {
      console.warn(`[Proposal] Failed to send completion notification for ${projectId}:`, notifErr);
    }

    console.info('[Proposal] project workflow completed', {
      projectId,
      completedBy,
    });
  }

  /** Persist the AI pipeline lifecycle separately from the project workflow status. */
  async updateAnalysisStatus(
    projectId: string,
    analysisStatus: ProjectAnalysisStatus,
  ): Promise<void> {
    const project = await this.projectRepo.updateById(projectId, { analysisStatus });
    if (!project) throw new AppError('Project not found', StatusCodes.NOT_FOUND);

    await this.recordAnalysisAudit(projectId, analysisStatus, project.referenceNumber);
  }

  /** The proposal schema as currently saved; used to log the result of an AI push. */
  async getSavedSchema(projectId: string): Promise<IProjectSchema> {
    return this.proposalRepo.getCurrentSchema(projectId);
  }

  private async recordAnalysisAudit(
    projectId: string,
    analysisStatus: ProjectAnalysisStatus,
    targetLabel?: string | null,
  ): Promise<void> {
    await this.auditLogService?.recordBestEffort({
      action: `extraction.${analysisStatus.toLowerCase()}`,
      category: AuditLogCategory.EXTRACTION,
      visibility: AuditLogVisibility.BASIC,
      actorId: 'system',
      projectId,
      targetType: 'PROJECT',
      targetId: projectId,
      targetLabel: targetLabel ?? null,
      description: `AI extraction ${analysisStatus.toLowerCase()}`,
      metadata: { analysisStatus },
      source: AuditLogSource.SYSTEM,
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // AUTHORIZATION GUARDS
  // ───────────────────────────────────────────────────────────────────────────

  /** Returns the project so callers do not have to look it up a second time. */
  private async _ensureEstimatorAssigned(projectId: string, userId: string, userRole?: string): Promise<IDomainProject> {
    const project = await this.projectRepo.findById(projectId);
    if (!project) throw new AppError('Project not found', StatusCodes.NOT_FOUND);
    if (hasAnyRole(userRole, ['SUPER_ADMIN', 'SYSTEM_ADMIN', 'SALES_MANAGER'])) {
      return project;
    }

    const hasAssignment = project.assignedEstimators?.some((e: any) => String(e.id || e) === String(userId));
    if (!hasAssignment) {
      throw new AppError(
        'You are not authorized to edit or approve this proposal. Only the assigned estimator can perform this action.',
        StatusCodes.FORBIDDEN,
        true,
        { code: ErrorCode.UNAUTHORIZED }
      );
    }
    return project;
  }

  /**
   * A Sales Manager or Head of Division can perform estimator edits through
   * their elevated access. When no estimator owns the project yet, the first
   * such edit claims that assignment so the project list records who is doing
   * the estimation. Existing assignments are never replaced here.
   */
  private async _claimUnassignedProjectForElevatedEditor(
    project: IDomainProject,
    userId: string,
    userRole?: string,
  ): Promise<void> {
    if (!hasAnyRole(userRole, ['SALES_MANAGER']) || (project.assignedEstimators?.length ?? 0) > 0) {
      return;
    }

    await this.projectRepo.updateById(project.id, {
      assignedEstimators: [userId],
    });
  }

  private async _ensureEditAccessAndClaimAssignment(
    projectId: string,
    userId: string,
    userRole?: string,
  ): Promise<void> {
    const project = await this._ensureEstimatorAssigned(projectId, userId, userRole);
    await this._claimUnassignedProjectForElevatedEditor(project, userId, userRole);
  }

  /**
   * Excel/PDF download is locked until Stage 7 has been approved through the
   * gated Sales Manager approval flow (assign -> notify -> explicit approve).
   * Both `pipeline_status.stage_7_status` and `stage_7.status` are checked,
   * matching the OR pattern used elsewhere in this file for "is stage 7
   * approved".
   */
  private async _ensureStage7DownloadApproved(projectId: string): Promise<IProjectSchema> {
    const schema = await this.proposalRepo.getCurrentSchema(projectId);
    const isApproved =
      schema?.pipeline_status?.stage_7_status === 'APPROVED' || schema?.stage_7?.status === 'APPROVED';
    if (!isApproved) {
      throw new AppError(
        'Excel/PDF download is locked until Stage 7 is approved by the assigned Sales Manager.',
        StatusCodes.FORBIDDEN,
        true,
        { code: ErrorCode.UNAUTHORIZED },
      );
    }
    return schema;
  }

  private _proposalSendReadiness(
    schema: IProjectSchema,
    hasFinalOutput: boolean,
  ): ProposalSendReadiness {
    const managerApproved =
      schema?.pipeline_status?.stage_7_status === 'APPROVED' || schema?.stage_7?.status === 'APPROVED';
    const outputActioned = Boolean(schema.stage_6_proposal?.output_action_at);
    const sent = Boolean(schema.stage_6_proposal?.sent_at);

    let reason: string | null = null;
    if (!managerApproved) reason = 'Waiting for Sales Manager approval.';
    else if (!hasFinalOutput) reason = 'Generate the final proposal output first.';
    else if (!outputActioned) reason = 'Open or download the final output before sending.';
    else if (sent) reason = 'The proposal has already been sent.';

    return {
      managerApproved,
      finalOutputReady: hasFinalOutput,
      finalOutputActioned: outputActioned,
      sent,
      canSend: managerApproved && hasFinalOutput && outputActioned && !sent,
      reason,
    };
  }

  private async _markProposalOutputAction(projectId: string, userId: string): Promise<void> {
    const currentSchema = await this.proposalRepo.getCurrentSchema(projectId);
    if (!currentSchema.stage_6_proposal) return;

    const nextSchema = structuredClone(currentSchema) as IProjectSchema;
    const proposalOutput = nextSchema.stage_6_proposal!;
    proposalOutput.output_action_at = new Date();
    proposalOutput.output_action_by = userId;
    await this.proposalRepo.appendVersion({
      projectId,
      nextSchema,
      changedFieldPaths: ['stage_6_proposal.output_action_at', 'stage_6_proposal.output_action_by'],
      source: 'ESTIMATOR',
      updatedBy: userId,
      stage: 6,
      versionKey: 'stage_6_proposal',
    });
  }

  private async _markProposalSent(projectId: string, userId: string): Promise<void> {
    const currentSchema = await this.proposalRepo.getCurrentSchema(projectId);
    if (!currentSchema.stage_6_proposal) return;

    const nextSchema = structuredClone(currentSchema) as IProjectSchema;
    const proposalOutput = nextSchema.stage_6_proposal!;
    proposalOutput.sent_at = new Date();
    proposalOutput.sent_by = userId;
    await this.proposalRepo.appendVersion({
      projectId,
      nextSchema,
      changedFieldPaths: ['stage_6_proposal.sent_at', 'stage_6_proposal.sent_by'],
      source: 'ESTIMATOR',
      updatedBy: userId,
      stage: 6,
      versionKey: 'stage_6_proposal',
    });
  }

  private _checkPrerequisite(schema: IProjectSchema, stage: WorkflowStage) {
    if (stage === 1) return;

    if (stage === 7) {
      const unapproved = [1, 2, 3, 4, 5].find(
        (s) => (schema.pipeline_status as any)?.[`stage_${s}_status`] !== 'APPROVED',
      );
      if (unapproved !== undefined) {
        throw new AppError(
          `Prerequisite not met: Stage ${unapproved} must be APPROVED first`,
          StatusCodes.UNPROCESSABLE_ENTITY,
          true,
          { code: ErrorCode.VALIDATION_ERROR },
        );
      }
    }

    // Handle legacy state where stage 6 was left PENDING instead of auto-approved
    if (stage === 7 && schema.pipeline_status.stage_6_status !== 'APPROVED') {
      if (schema.pipeline_status.stage_5_status === 'APPROVED') {
        return;
      }
    }

    const prevStage = (stage - 1) as WorkflowStage;
    const prevStatus = (schema.pipeline_status as any)[`stage_${prevStage}_status`];
    if (prevStatus !== 'APPROVED') {
      throw new AppError(
        `Prerequisite not met: Stage ${prevStage} must be APPROVED first`,
        StatusCodes.UNPROCESSABLE_ENTITY,
        true,
        { code: ErrorCode.VALIDATION_ERROR }
      );
    }
  }

  /**
   * Stage that owns a top-level schema key, or null when the key is not
   * stage-scoped. Takeoff units live at the schema root but belong to Stage 4.
   */
  private _ownerStageOfSchemaKey(key: string): number | null {
    const match = /^stage_(\d)$/.exec(key);
    if (match) return Number(match[1]);
    // stage_6_proposal is the Proposal-tab twin of stage_6 (MD §3/§5.3) —
    // scope/version it with stage 6 so a stage-6 push is authoritative for it.
    if (key === 'stage_6_proposal') return 6;
    if (key === 'units') return 4;
    return null;
  }

  /**
   * Every value leaf under a schema node, keyed by its dotted path. Used to tell
   * a real change from the AI re-sending the data it sent last run: only the
   * values matter here, not reasoning/confidence/citations, which are free to
   * refresh without costing the estimator an approval.
   */
  private _collectFieldValues(
    node: any,
    prefix = '',
    out: Record<string, string> = {},
  ): Record<string, string> {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return out;

    // Takeoff rows carry value_width_in, value_length_in, ... instead of `value`.
    const isFieldNode = 'value' in node || Object.keys(node).some((key) => key.startsWith('value_'));
    if (isFieldNode) {
      for (const [key, value] of Object.entries(node)) {
        if (key === 'value' || key.startsWith('value_')) {
          out[`${prefix}.${key}`] = JSON.stringify(value ?? null);
        }
      }
      return out;
    }

    for (const [key, child] of Object.entries<any>(node)) {
      if (key === '_meta' || key === '_feedback' || key === '_signals') continue;
      this._collectFieldValues(child, prefix ? `${prefix}.${key}` : key, out);
    }
    return out;
  }

  private _filterFieldsToShow(schema: IProjectSchema, stage: WorkflowStage) {
    // Return only the fields for the given stage, filtering out internal _signals
    const stageKey = `stage_${stage}` as keyof IProjectSchema;
    if (stageKey === 'pipeline_status') return {};
    if (stage === 6) return {}; // Stage 6 is internal mapper only, not shown to frontend
    if (stage === 7) return this._buildStage7Response(schema);

    const stageData = schema[stageKey] as any;
    const filtered: any = {};
    const applyRegistryMeta = (path: string, value: any): any => {
      const definition = getFieldDefinition(path);
      if (definition && value && typeof value === 'object' && 'value' in value) {
        const normalizedValue = path === 'stage_1.contact_phone'
          ? normalizePhoneValue(value.value)
          : value.value;
        return {
          ...value,
          value: normalizedValue,
          ...(path === 'stage_1.contact_phone' && 'extracted_value' in value
            ? { extracted_value: normalizePhoneValue(value.extracted_value) }
            : {}),
          _meta: {
            ...(value._meta ?? {}),
            manual: definition.manual,
            ...(definition.valueType && { value_type: definition.valueType }),
            ...(definition.editable !== undefined && { editable: definition.editable }),
            ...(definition.min !== undefined && { min: definition.min }),
            ...(definition.max !== undefined && { max: definition.max }),
            ...(definition.allowedValues && { allowed_values: definition.allowedValues }),
            ...(definition.excelCell && { excel_cell: definition.excelCell }),
            ...(definition.note && { note: definition.note }),
          },
        };
      }
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return Object.fromEntries(
          Object.entries(value).map(([childKey, childValue]) => [
            childKey,
            applyRegistryMeta(`${path}.${childKey}`, childValue),
          ]),
        );
      }
      return value;
    };

    for (const key of Object.keys(stageData)) {
      // Re-apply current registry metadata on read so older proposal documents receive
      // the same editor rules as newly created proposals without a database migration.
      filtered[key] = applyRegistryMeta(`${stageKey}.${key}`, stageData[key]);
    }
    if (stage === 1) {
      delete filtered.quote_number;
    }
    
    // Stage 2 and 3 use the same unit map as Stage 4, but only expose the
    // specification relevant to the current screen. This lets the workspace
    // show an AI-provided per-unit decision without treating the global
    // Stage 2/3 value as a value for every unit.
    if (stage === 2 || stage === 3) {
      const unitField = stage === 2 ? 'value_glass_type' : 'value_frame_type';
      const units = schema.units || (schema.stage_4 as any)?.takeoff?.units || (schema.stage_4 as any)?.units || {};

      filtered.units = Object.fromEntries(
        Object.entries(units).map(([key, unit]: [string, any]) => [
          key,
          {
            unit_id: unit?.unit_id ?? key,
            [unitField]: unit?.[unitField] ?? null,
            // Keep the AI explanation with the unit decision. Stage 2/3 used
            // to expose only the selected value, which forced the UI to show
            // a read-only summary with no unit-level reasoning or confidence.
            reasoning: unit?.reasoning ?? [],
            extracted_confidence: unit?.extracted_confidence ?? null,
            extracted_citation: unit?.extracted_citation ?? null,
            extracted_verbatim: unit?.extracted_verbatim ?? null,
            status: unit?.status ?? null,
          },
        ]),
      );
    }

    // Stage 4 remains the complete per-unit editing surface.
    if (stage === 4) {
      // Show the safe single-unit default immediately. It is persisted only
      // when the estimator approves Stage 4, so simply viewing a project
      // never changes data.
      const displayedSchema = structuredClone(schema) as IProjectSchema;
      this._applySingleUnitProjectDefaults(displayedSchema);
      filtered.units = displayedSchema.units || (schema.stage_4 as any)?.takeoff?.units || (schema.stage_4 as any)?.units;
      filtered.unit_field_meta = Object.fromEntries(
        Object.entries(getUnitFieldDefinitions()).map(([field, definition]) => [field, {
          value_type: definition.valueType,
          ...(definition.min !== undefined && { min: definition.min }),
          ...(definition.max !== undefined && { max: definition.max }),
          ...(definition.allowedValues && { allowed_values: definition.allowedValues }),
          editable: true,
        }]),
      );
    }

    // Combine signals from all stages so frontend can resolve cross-stage citations and reasoning
    filtered._signals = {
      ...((schema.stage_1 as any)?._signals ?? {}),
      ...((schema.stage_1 as any)?.header_signals ?? {}),
      ...((schema.stage_2 as any)?._signals ?? {}),
      ...((schema.stage_3 as any)?._signals ?? {}),
      ...((schema.stage_4 as any)?._signals ?? {}),
      ...((schema.stage_5 as any)?._signals ?? {}),
    };
    
    // Include stage-level reasoning for reasoning resolution
    if ((schema.stage_1 as any)?.reasoning) {
      filtered.reasoning = (schema.stage_1 as any).reasoning;
    }
    if ((schema.stage_4 as any)?.reasoning) {
      filtered.stage_4_reasoning = (schema.stage_4 as any).reasoning;
    }

    return filtered;
  }

  private _resolveEstimatorNames(project: IDomainProject | null | undefined): string[] {
    if (!project) return [];
    let estimatorNames: string[] = [];
    if (project.assignedEstimators && project.assignedEstimators.length > 0) {
      estimatorNames = (project.assignedEstimators as any[])
        .map((e: any) => (e.name ? e.name : `${e.firstName ?? ''} ${e.lastName ?? ''}`.trim()))
        .filter((name: string) => Boolean(name && name !== 'Unknown Estimator'));
    }
    if (estimatorNames.length === 0 && project.estimatorName) {
      const trimmed = project.estimatorName.trim();
      if (trimmed && trimmed !== 'Unknown Estimator') {
        estimatorNames = [trimmed];
      }
    }
    return estimatorNames;
  }

  private _buildStage7Response(schema: IProjectSchema) {
    const approved_stages_summary: any = {};
    
    // Build summary from approved stages
    if (schema.stage_1) {
      approved_stages_summary.stage_1 = {
        project_name: schema.stage_1.project_name?.value,
        project_address: schema.stage_1.project_address?.value,
      };
    }
    if (schema.stage_2) {
      approved_stages_summary.stage_2 = { glass_type: schema.stage_2.glass_type?.value };
    }
    if (schema.stage_3) {
      approved_stages_summary.stage_3 = {
        frame_type: schema.stage_3.decision?.frame_type?.value,
        assembly_type: schema.stage_3.decision?.assembly_type?.value,
      };
    }
    if (schema.stage_4) {
      approved_stages_summary.stage_4 = {
        crossbeam: schema.stage_4.crossbeam?.value,
        panel_count: schema.stage_4.takeoff?.panel_count?.value,
      };
      const units: any = {};
      for (const [key, unit] of Object.entries(schema.units || {})) {
        // Every project is pre-seeded with units A-J (value_num_units: 1), so
        // skip slots that never received real take-off data.
        if (!hasRealUnitData(unit)) continue;
        units[key] = {
          unit_label: (unit as any).unit_label ?? null,
          value_frame_type: unit.value_frame_type,
          value_glass_type: unit.value_glass_type,
          value_cross_beam: unit.value_cross_beam,
          extracted_cross_beam: unit.extracted_cross_beam,
          cross_beam_confidence: unit.cross_beam_confidence,
          cross_beam_reasoning: unit.cross_beam_reasoning,
          cross_beam_citation: unit.cross_beam_citation,
          value_glass_thickness: unit.value_glass_thickness,
          value_width_in: unit.value_width_in,
          value_length_in: unit.value_length_in,
          value_panel_count: unit.value_panel_count,
          value_num_units: unit.value_num_units,
          value_location: unit.value_location,
          value_drawing_number: unit.value_drawing_number,
          value_vertical_rafter_count: unit.value_vertical_rafter_count,
          value_horizontal_rafter_count: unit.value_horizontal_rafter_count,
          value_rows: unit.value_rows,
          value_columns: unit.value_columns ?? (unit as any).value_cols ?? null,
          value_cols: (unit as any).value_cols ?? unit.value_columns ?? null,
          value_is_grid_confirmed: (unit as any).value_is_grid_confirmed ?? null,
          value_t_rafter_details: unit.value_t_rafter_details,
          value_layout_source: unit.value_layout_source,
          value_man_hours: resolveUnitManHours(schema, key),
          value_packaging: resolveUnitPackaging(schema, key),
          value_description: resolveUnitDescription(schema, key),
        };
      }
      approved_stages_summary.units = units;
    }
    const calculation = calculateFinalParameters(
      schema,
      schema.stage_7?.cost_overrides ?? {},
      schema.stage_7?.quantity_overrides ?? {},
    );

    if (schema.stage_5) {
      approved_stages_summary.stage_5 = {
        addons: {
          duty: schema.stage_5.addons?.duty?.value,
          heat_soak_testing: schema.stage_5.addons?.heat_soak_testing?.value,
          nanodot: schema.stage_5.addons?.nanodot?.value,
          seeded_organic: schema.stage_5.addons?.seeded_organic?.value,
          sentry_glass: schema.stage_5.addons?.sentry_glass?.value,
          krypton_gas: schema.stage_5.addons?.krypton_gas?.value,
          custom_shape: schema.stage_5.addons?.custom_shape?.value,
          backpaint: schema.stage_5.addons?.backpaint?.value,
        },
        calculated: {
          total_sqft: schema.stage_5.calculated?.total_sqft?.value ?? calculation.metrics?.totalSqft,
          total_weight: schema.stage_5.calculated?.total_weight?.value,
          perimeter_lf: schema.stage_5.calculated?.perimeter_lf?.value ?? calculation.metrics?.perimeterLf,
          silicone_tubes: schema.stage_5.calculated?.silicone_tubes?.value,
          total_man_hours: schema.stage_5.calculated?.total_man_hours?.value ?? calculation.metrics?.totalManHours,
          total_packaging: schema.stage_5.calculated?.total_packaging?.value ?? calculation.metrics?.totalPackaging,
        },
      };
    }

    let computedSnapshot = schema.stage_7?.computed_snapshot;
    if (
      !computedSnapshot ||
      !Number.isFinite(computedSnapshot.final_price) ||
      (calculation.finalPrice > 0 && Math.abs((computedSnapshot.final_price ?? 0) - calculation.finalPrice) > 0.05) ||
      (calculation.grandTotal > 0 && Math.abs((computedSnapshot.grand_total ?? 0) - calculation.grandTotal) > 0.05)
    ) {
      computedSnapshot = {
        subtotal: calculation.subtotal,
        total: calculation.total,
        final_price: calculation.finalPrice,
        optional_add_on_total: calculation.optionalAddOnTotal,
        grand_total: calculation.grandTotal,
      };
    }

    return {
      cost_overrides: schema.stage_7?.cost_overrides || {},
      quantity_overrides: schema.stage_7?.quantity_overrides || {},
      additional_charge_selections: {
        ...DEFAULT_ADDITIONAL_CHARGE_SELECTIONS,
        ...(schema.stage_7?.additional_charge_selections ?? {}),
      },
      optional_add_on_statuses: getOptionalAddOnStatuses(schema),
      computed_snapshot: computedSnapshot,
      approved_stages_summary,
      approval: schema.stage_7?.approval ?? null,
      previous_stages_approved: [1, 2, 3, 4, 5].every(
        (s) => (schema.pipeline_status as any)?.[`stage_${s}_status`] === 'APPROVED',
      ),
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // STAGE 7: INITIALIZE & UPDATE COST
  // ───────────────────────────────────────────────────────────────────────────

  public async initializeStage7(projectId: string): Promise<void> {
    const templateBuffer = await loadTemplateBuffer();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(templateBuffer as any);
    const sheet = workbook.worksheets[0];
    if (!sheet) {
      throw new Error('Template does not contain any worksheets');
    }

    const costCells = [
      'C9', 'C10', 'C11', 'C12', 'C13', 'C14', 'C16', 'C17', 'C18', 'C19', 'C20', 'C21',
      'C35', 'C36', 'C37', 'C38', 'C39', 'C40', 'C41', 'C42', 'C43', 'C44', 'C45', 'C46', 'C47',
      'C49', 'C50', 'C51', 'C52', 'C53', 'C54', 'C55', 'C56', 'C57', 'C58', 'C59', 'C60',
      'C61', 'C62', 'C63', 'C64', 'C66', 'C67', 'C68', 'C69',
      'C71', 'C72', 'C73', 
      'C75', 'C76', 'C77', 'C78', 'C79', 'C80', 'C81', 'C82',
      'C85', 'C86', 'C87', 'C88', 'C89', 'C90', 'C91', 'C93', 'C94',
      'C107', 'C109', 'C110'
    ];

    const costOverrides: Record<string, number> = {};
    for (const address of costCells) {
      const cell = sheet.getCell(address);
      let val = cell.value;
      if (val !== null && typeof val === 'object' && 'result' in val) {
        val = val.result;
      }
      
      const parsedVal = parseParameterValue(val as string | number);
      if (typeof parsedVal === 'number') {
        costOverrides[address] = parsedVal;
      }
    }

    const currentSchema = await this.proposalRepo.getCurrentSchema(projectId);

    // Preserve estimator-entered cost overrides across revisions/re-runs.
    // Template seeds only fill cells the estimator has not manually overridden.
    const existingOverrides = currentSchema.stage_7?.cost_overrides ?? {};
    const existingQuantityOverrides = currentSchema.stage_7?.quantity_overrides ?? {};

    currentSchema.stage_7 = {
      status: 'READY',
      cost_overrides: { ...costOverrides, ...existingOverrides },
      quantity_overrides: existingQuantityOverrides,
      additional_charge_selections: {
        ...DEFAULT_ADDITIONAL_CHARGE_SELECTIONS,
        ...(currentSchema.stage_7?.additional_charge_selections ?? {}),
      },
      optional_add_on_statuses: getOptionalAddOnStatuses(currentSchema),
      updated_at: new Date(),
    };
    (currentSchema.pipeline_status as any).stage_7_status = 'PENDING';

    await this.proposalRepo.appendVersion({
      projectId,
      nextSchema: currentSchema,
      changedFieldPaths: ['stage_7', 'pipeline_status.stage_7_status'],
      source: 'AI',
      updatedBy: 'system',
      stage: 7
    });

    const fieldsToShow = this._filterFieldsToShow(currentSchema, 7);
    proposalEventBus.emit(ProposalEvent.STAGE_PUSHED, {
      projectId,
      data: { stage: 7, fields_to_show: fieldsToShow },
    });
  }

  public async updateStage7Cost(
    projectId: string,
    cell: string,
    cost: number,
    updatedBy: string,
    userRole?: string,
    feedback?: FieldPatch['feedback'],
  ): Promise<any> {
    await this._ensureEditAccessAndClaimAssignment(projectId, updatedBy, userRole);
    
    const allowedCells = [
      'C9', 'C10', 'C11', 'C12', 'C13', 'C14', 'C16', 'C17', 'C18', 'C19', 'C20', 'C21',
      'C35', 'C36', 'C37', 'C38', 'C39', 'C40', 'C41', 'C42', 'C43', 'C44', 'C45', 'C46', 'C47',
      'C49', 'C50', 'C51', 'C52', 'C53', 'C54', 'C55', 'C56', 'C57', 'C58', 'C59', 'C60',
      'C61', 'C62', 'C63', 'C64', 'C66', 'C67', 'C68', 'C69', // Added parts and gaskets
      'C71', 'C72', 'C73', 
      'C75', 'C76', 'C77', 'C78', 'C79', 'C80', 'C81', 'C82', // Added Additional Charges
      'C85', 'C86', 'C87', 'C88', 'C89', 'C90', 'C91', 'C93', 'C94', // Shipping & Markup
      'C107', 'C109', 'C110'
    ];

    if (!allowedCells.includes(cell)) {
      throw new AppError(`Invalid cost cell address: ${cell}`, StatusCodes.BAD_REQUEST);
    }

    const currentSchema = await this.proposalRepo.getCurrentSchema(projectId);
    
    if (!currentSchema.stage_7) {
      currentSchema.stage_7 = { status: 'PENDING', cost_overrides: {} };
    }
    if (!currentSchema.stage_7.cost_overrides) {
      currentSchema.stage_7.cost_overrides = {};
    }
    
    const previousCost = currentSchema.stage_7.cost_overrides[cell];

    if (feedback && previousCost !== null && previousCost !== undefined) {
      if (!currentSchema.stage_7.cost_feedback) currentSchema.stage_7.cost_feedback = {};
      const entries = currentSchema.stage_7.cost_feedback[cell] ?? [];
      entries.push(
        buildFeedbackEntry(feedback, {
          previousValue: previousCost,
          newValue: cost,
          author: { source: 'ESTIMATOR', updatedBy, authorRole: userRole },
          stage: 7,
        }),
      );
      currentSchema.stage_7.cost_feedback[cell] = capEntries(entries);
    }

    currentSchema.stage_7.cost_overrides[cell] = cost;
    // A cost edit makes the stored workbook snapshot stale. The next export
    // must be rebuilt from the current schema and calculator result.
    delete currentSchema.stage_7.computed_snapshot;
    currentSchema.stage_7.updated_at = new Date();
    currentSchema.stage_7.updated_by = updatedBy;

    await this.proposalRepo.appendVersion({
      projectId,
      nextSchema: currentSchema,
      changedFieldPaths: [`stage_7.cost_overrides.${cell}`],
      source: 'ESTIMATOR',
      updatedBy,
      stage: 7
    });

    const finalPrice = this.computeProposalPrice(currentSchema);
    if (finalPrice && finalPrice > 0) {
      await this.projectRepo.updateById(projectId, {
        estimatedCost: finalPrice,
      });
    }

    proposalEventBus.emit(ProposalEvent.STAGE_7_COST_UPDATED, {
      projectId,
      data: { cell, new_cost: cost, cost_overrides: currentSchema.stage_7.cost_overrides }
    });

    return {
      stage: 7,
      updated_cell: cell,
      new_cost: cost,
      stage_6_cells_updated: true
    };
  }

  public async updateStage7Quantity(
    projectId: string,
    cell: string,
    quantity: number,
    updatedBy: string,
    userRole?: string,
    feedback?: FieldPatch['feedback'],
  ): Promise<any> {
    await this._ensureEditAccessAndClaimAssignment(projectId, updatedBy, userRole);

    const allowedCells = [
      'C9', 'C10', 'C11', 'C12', 'C13', 'C14',
      'C16', 'C17', 'C20', 'C21', 'C107', 'C109', 'C110',
      'C38', 'C39', 'C40', 'C41', 'C42', 'C43', 'C44', 'C45', 'C46', 'C47', 'C48', 'C49', 'C50',
      'C53', 'C54', 'C55', 'C56', 'C57', 'C58', 'C59', 'C60',
      'C62', 'C63', 'C64', 'C66', 'C67', 'C68',
      'C71', 'C72', 'C73',
    ];

    if (!allowedCells.includes(cell) && !isUnitQuantityOverrideKey(cell)) {
      throw new AppError(`Invalid quantity cell address: ${cell}`, StatusCodes.BAD_REQUEST);
    }

    if (quantity < 0 || !Number.isFinite(quantity)) {
      throw new AppError('Quantity must be a non-negative number', StatusCodes.BAD_REQUEST);
    }

    const currentSchema = await this.proposalRepo.getCurrentSchema(projectId);

    if (!currentSchema.stage_7) {
      currentSchema.stage_7 = { status: 'PENDING', cost_overrides: {} };
    }
    if (!currentSchema.stage_7.quantity_overrides) {
      currentSchema.stage_7.quantity_overrides = {};
    }

    const previousQuantity = currentSchema.stage_7.quantity_overrides[cell];

    if (feedback && previousQuantity !== null && previousQuantity !== undefined) {
      if (!currentSchema.stage_7.cost_feedback) currentSchema.stage_7.cost_feedback = {};
      const entries = currentSchema.stage_7.cost_feedback[`qty_${cell}`] ?? [];
      entries.push(
        buildFeedbackEntry(feedback, {
          previousValue: previousQuantity,
          newValue: quantity,
          author: { source: 'ESTIMATOR', updatedBy, authorRole: userRole },
          stage: 7,
        }),
      );
      currentSchema.stage_7.cost_feedback[`qty_${cell}`] = capEntries(entries);
    }

    currentSchema.stage_7.quantity_overrides[cell] = quantity;
    delete currentSchema.stage_7.computed_snapshot;
    currentSchema.stage_7.updated_at = new Date();
    currentSchema.stage_7.updated_by = updatedBy;

    const changedPaths: string[] = [`stage_7.quantity_overrides.${cell}`];
    const glassCells = ['C9', 'C10', 'C11', 'C12', 'C13', 'C14'];
    const frameCells = ['C38', 'C39', 'C40', 'C41', 'C42', 'C43', 'C44', 'C45', 'C46', 'C47', 'C48', 'C49', 'C50'];
    if (glassCells.includes(cell)) {
      if (!currentSchema.stage_5) currentSchema.stage_5 = { _signals: {}, addons: {}, calculated: {} } as any;
      if (!currentSchema.stage_5.calculated) currentSchema.stage_5.calculated = {} as any;
      if (!currentSchema.stage_5.calculated.total_sqft) {
        currentSchema.stage_5.calculated.total_sqft = { value: quantity, status: 'APPROVED' } as any;
      } else {
        currentSchema.stage_5.calculated.total_sqft.value = quantity;
      }
      changedPaths.push('stage_5.calculated.total_sqft');
    } else if (frameCells.includes(cell)) {
      if (!currentSchema.stage_5) currentSchema.stage_5 = { _signals: {}, addons: {}, calculated: {} } as any;
      if (!currentSchema.stage_5.calculated) currentSchema.stage_5.calculated = {} as any;
      if (!currentSchema.stage_5.calculated.perimeter_lf) {
        currentSchema.stage_5.calculated.perimeter_lf = { value: quantity, status: 'APPROVED' } as any;
      } else {
        currentSchema.stage_5.calculated.perimeter_lf.value = quantity;
      }
      changedPaths.push('stage_5.calculated.perimeter_lf');
    } else if (cell === 'C64') {
      if (!currentSchema.stage_5) currentSchema.stage_5 = { _signals: {}, addons: {}, calculated: {} } as any;
      if (!currentSchema.stage_5.calculated) currentSchema.stage_5.calculated = {} as any;
      if (!currentSchema.stage_5.calculated.silicone_tubes) {
        currentSchema.stage_5.calculated.silicone_tubes = { value: quantity, status: 'APPROVED' } as any;
      } else {
        currentSchema.stage_5.calculated.silicone_tubes.value = quantity;
      }
      changedPaths.push('stage_5.calculated.silicone_tubes');
    } else if (cell === 'C71') {
      if (!currentSchema.stage_5) currentSchema.stage_5 = { _signals: {}, addons: {}, calculated: {} } as any;
      if (!currentSchema.stage_5.calculated) currentSchema.stage_5.calculated = {} as any;
      if (!currentSchema.stage_5.calculated.total_man_hours) {
        currentSchema.stage_5.calculated.total_man_hours = { value: quantity, status: 'APPROVED' } as any;
      } else {
        currentSchema.stage_5.calculated.total_man_hours.value = quantity;
      }
      changedPaths.push('stage_5.calculated.total_man_hours');
    }

    else if (cell === 'C73') {
      if (!currentSchema.stage_5) currentSchema.stage_5 = { _signals: {}, addons: {}, calculated: {} } as any;
      if (!currentSchema.stage_5.calculated) currentSchema.stage_5.calculated = {} as any;
      if (!currentSchema.stage_5.calculated.total_packaging) {
        currentSchema.stage_5.calculated.total_packaging = { value: quantity, status: 'APPROVED' } as any;
      } else {
        currentSchema.stage_5.calculated.total_packaging.value = quantity;
      }
      changedPaths.push('stage_5.calculated.total_packaging');
    }

    await this.proposalRepo.appendVersion({
      projectId,
      nextSchema: currentSchema,
      changedFieldPaths: changedPaths,
      source: 'ESTIMATOR',
      updatedBy,
      stage: 7,
    });

    const finalPrice = this.computeProposalPrice(currentSchema);
    if (finalPrice && finalPrice > 0) {
      await this.projectRepo.updateById(projectId, {
        estimatedCost: finalPrice,
      });
    }

    proposalEventBus.emit(ProposalEvent.STAGE_7_QUANTITY_UPDATED, {
      projectId,
      data: { cell, new_quantity: quantity, quantity_overrides: currentSchema.stage_7.quantity_overrides },
    });

    return {
      stage: 7,
      updated_cell: cell,
      new_quantity: quantity,
      quantity_overrides: currentSchema.stage_7.quantity_overrides,
    };
  }

  public async updateStage7ChargeSelection(
    projectId: string,
    cell: string,
    selection: 'Y' | 'N',
    updatedBy: string,
    userRole?: string,
    feedback?: FieldPatch['feedback'],
  ): Promise<any> {
    await this._ensureEditAccessAndClaimAssignment(projectId, updatedBy, userRole);

    if (!ADDITIONAL_CHARGE_CELLS.includes(cell as (typeof ADDITIONAL_CHARGE_CELLS)[number])) {
      throw new AppError(`Invalid additional charge cell address: ${cell}`, StatusCodes.BAD_REQUEST);
    }

    const currentSchema = await this.proposalRepo.getCurrentSchema(projectId);
    if (!currentSchema.stage_7) {
      currentSchema.stage_7 = { status: 'PENDING', cost_overrides: {} };
    }
    const selections = {
      ...DEFAULT_ADDITIONAL_CHARGE_SELECTIONS,
      ...(currentSchema.stage_7.additional_charge_selections ?? {}),
    };
    const previousSelection = selections[cell] ?? 'N';

    if (feedback && previousSelection !== selection) {
      if (!currentSchema.stage_7.cost_feedback) currentSchema.stage_7.cost_feedback = {};
      const entries = currentSchema.stage_7.cost_feedback[cell] ?? [];
      entries.push(
        buildFeedbackEntry(feedback, {
          previousValue: previousSelection,
          newValue: selection,
          author: { source: 'ESTIMATOR', updatedBy, authorRole: userRole },
          stage: 7,
        }),
      );
      currentSchema.stage_7.cost_feedback[cell] = capEntries(entries);
    }

    selections[cell] = selection;
    currentSchema.stage_7.additional_charge_selections = selections;
    // Keep the persisted proposal from representing an older Y/N selection.
    delete currentSchema.stage_7.computed_snapshot;
    currentSchema.stage_7.updated_at = new Date();
    currentSchema.stage_7.updated_by = updatedBy;

    await this.proposalRepo.appendVersion({
      projectId,
      nextSchema: currentSchema,
      changedFieldPaths: [`stage_7.additional_charge_selections.${cell}`],
      source: 'ESTIMATOR',
      updatedBy,
      stage: 7,
    });

    const finalPrice = this.computeProposalPrice(currentSchema);
    if (finalPrice && finalPrice > 0) {
      await this.projectRepo.updateById(projectId, { estimatedCost: finalPrice });
    }

    proposalEventBus.emit(ProposalEvent.STAGE_7_CHARGE_SELECTION_UPDATED, {
      projectId,
      data: { cell, selection, additional_charge_selections: selections },
    });

    return {
      stage: 7,
      updated_cell: cell,
      selection,
      additional_charge_selections: selections,
    };
  }

  public async updateStage7OptionalAddOnStatus(
    projectId: string,
    cell: string,
    status: OptionalAddOnStatus,
    updatedBy: string,
    userRole?: string,
  ): Promise<any> {
    await this._ensureEditAccessAndClaimAssignment(projectId, updatedBy, userRole);

    if (!OPTIONAL_ADD_ON_CELLS.includes(cell as (typeof OPTIONAL_ADD_ON_CELLS)[number])) {
      throw new AppError(`Invalid optional add-on cell address: ${cell}`, StatusCodes.BAD_REQUEST);
    }

    const currentSchema = await this.proposalRepo.getCurrentSchema(projectId);
    if (!currentSchema.stage_7) {
      currentSchema.stage_7 = { status: 'PENDING', cost_overrides: {} };
    }

    const statuses = getOptionalAddOnStatuses(currentSchema);
    const previousStatus = statuses[cell as (typeof OPTIONAL_ADD_ON_CELLS)[number]];
    statuses[cell as (typeof OPTIONAL_ADD_ON_CELLS)[number]] = status;
    currentSchema.stage_7.optional_add_on_statuses = statuses;
    delete currentSchema.stage_7.computed_snapshot;
    currentSchema.stage_7.updated_at = new Date();
    currentSchema.stage_7.updated_by = updatedBy;

    await this.proposalRepo.appendVersion({
      projectId,
      nextSchema: currentSchema,
      changedFieldPaths: [`stage_7.optional_add_on_statuses.${cell}`],
      source: 'ESTIMATOR',
      updatedBy,
      stage: 7,
    });

    const calculation = calculateFinalParameters(currentSchema, currentSchema.stage_7.cost_overrides ?? {});
    const finalPrice = this.computeProposalPrice(currentSchema);
    if (finalPrice && finalPrice > 0) {
      await this.projectRepo.updateById(projectId, { estimatedCost: finalPrice });
    }

    await this.auditLogService?.recordBestEffort({
      action: 'proposal.optional_add_on_status_updated',
      category: AuditLogCategory.PROPOSAL,
      visibility: AuditLogVisibility.FULL,
      actorId: updatedBy,
      projectId,
      targetType: 'PROJECT',
      targetId: projectId,
      description: `Optional add-on ${cell} marked ${status}`,
      metadata: { cell, previousStatus, status, grandTotal: calculation.grandTotal },
      before: { status: previousStatus },
      after: { status },
      source: AuditLogSource.API,
    });

    proposalEventBus.emit(ProposalEvent.STAGE_7_OPTIONAL_ADD_ON_STATUS_UPDATED, {
      projectId,
      data: { cell, status, optional_add_on_statuses: statuses, grand_total: calculation.grandTotal },
    });

    return {
      stage: 7,
      updated_cell: cell,
      status,
      optional_add_on_statuses: statuses,
      optional_add_on_total: calculation.optionalAddOnTotal,
      grand_total: calculation.grandTotal,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // STAGE 7: NAMED-APPROVER GATE (assign -> notify -> explicit approve)
  // ───────────────────────────────────────────────────────────────────────────

  /** Current Stage 7 price and assignment/approval state, for the eligible-approvers endpoint. */
  async getStage7ApprovalContext(
    projectId: string,
    userId: string,
    userRole?: string,
  ): Promise<{ finalPrice: number | null; approval: NonNullable<IProjectSchema['stage_7']>['approval'] | null }> {
    await this._ensureEstimatorAssigned(projectId, userId, userRole);
    const schema = await this.proposalRepo.getCurrentSchema(projectId);
    return {
      finalPrice: this.computeStage7ThresholdPrice(schema),
      approval: (schema?.stage_7?.approval ?? null) as any,
    };
  }

  async assignStage7Approver(
    projectId: string,
    approverId: string,
    assignedBy: string,
    assignedByRole?: string,
  ): Promise<any> {
    const project = await this._ensureEstimatorAssigned(projectId, assignedBy, assignedByRole);
    const currentSchema = await this.proposalRepo.getCurrentSchema(projectId);

    const alreadyApproved =
      currentSchema.pipeline_status?.stage_7_status === 'APPROVED' || currentSchema.stage_7?.status === 'APPROVED';
    if (alreadyApproved) {
      throw new AppError(
        'Stage 7 is already approved. Revise the stage before reassigning an approver.',
        StatusCodes.BAD_REQUEST,
      );
    }

    // Stage 7 is only reviewable once every earlier stage is approved. A revision
    // of any earlier stage cascades LOCKED onto stage 7, which closes this again.
    const unapprovedStage = [1, 2, 3, 4, 5].find(
      (s) => (currentSchema.pipeline_status as any)?.[`stage_${s}_status`] !== 'APPROVED',
    );
    if (unapprovedStage !== undefined || currentSchema.pipeline_status?.stage_7_status === 'LOCKED') {
      throw new AppError(
        `An approver can only be assigned once all previous stages are approved${
          unapprovedStage !== undefined ? ` (Stage ${unapprovedStage} is not approved)` : ''
        }.`,
        StatusCodes.UNPROCESSABLE_ENTITY,
        true,
        { code: ErrorCode.VALIDATION_ERROR },
      );
    }

    const finalPrice = this.computeStage7ThresholdPrice(currentSchema);

    const currentApproval = currentSchema.stage_7?.approval;
    const isSameActiveAssignment =
      currentApproval?.approverId != null &&
      String(currentApproval.approverId) === String(approverId) &&
      currentApproval.priceAtAssignment === finalPrice;
    if (isSameActiveAssignment) {
      // Retrying an unchanged assignment must not create a new proposal
      // version, audit entry, or notification. The existing request remains
      // the project's active approval queue item.
      return currentApproval;
    }

    const approver = await userRepository.findById(approverId);
    if (!approver) {
      throw new AppError('Approver not found', StatusCodes.NOT_FOUND, true, { code: ErrorCode.NOT_FOUND });
    }
    if (!isEligibleApprover(
      { role: approver.role, email: approver.email, isActive: approver.isActive },
      finalPrice,
    )) {
      throw new AppError(
        finalPrice !== null && finalPrice > env.proposalApproval.highValueThreshold
          ? 'This proposal exceeds the high-value threshold and can only be approved by a designated approver.'
          : 'This user is not an active Sales Manager and cannot be assigned as approver.',
        StatusCodes.FORBIDDEN,
        true,
        { code: ErrorCode.UNAUTHORIZED },
      );
    }

    const nextSchema = structuredClone(currentSchema) as IProjectSchema;
    if (!nextSchema.stage_7) {
      nextSchema.stage_7 = { status: 'PENDING', cost_overrides: {} };
    }
    const approverName = `${approver.firstName} ${approver.lastName}`.trim();
    nextSchema.stage_7.approval = {
      approverId: String(approver.id),
      approverName,
      approverEmail: approver.email,
      assignedBy,
      assignedAt: new Date(),
      approvedBy: null,
      approvedByName: null,
      approvedAt: null,
      priceAtAssignment: finalPrice,
    };

    await this.proposalRepo.appendVersion({
      projectId,
      nextSchema,
      changedFieldPaths: ['stage_7.approval'],
      source: 'ESTIMATOR',
      updatedBy: assignedBy,
      stage: 7,
    });

    const assigner = await userRepository.findById(assignedBy).catch(() => null);
    const assignerName = assigner ? `${assigner.firstName} ${assigner.lastName}`.trim() : null;

    await notificationService.notifyStage7ApprovalRequested({
      projectId,
      referenceNumber: project.referenceNumber,
      projectName: project.projectName,
      approverId: nextSchema.stage_7.approval.approverId!,
      approverName,
      finalPrice,
      assignedByName: assignerName,
    });

    await this.auditLogService?.recordBestEffort({
      action: 'proposal.stage7_approver_assigned',
      category: AuditLogCategory.APPROVAL,
      visibility: AuditLogVisibility.BASIC,
      actorId: assignedBy,
      actorRole: assignedByRole as any,
      projectId,
      targetType: 'PROJECT',
      targetId: projectId,
      targetLabel: project.referenceNumber,
      description: `${assignerName ?? 'A user'} assigned ${approverName} as Stage 7 approver`,
      metadata: { approverId, approverEmail: approver.email, finalPriceAtAssignment: finalPrice },
      source: AuditLogSource.API,
    });

    return nextSchema.stage_7.approval;
  }

  /**
   * Only the assigned approver (or a Super/System Admin, as an override) may
   * approve Stage 7. Unlike every other stage, `_ensureEstimatorAssigned`
   * alone is not enough here — it would let any Sales Manager approve,
   * defeating the named-approver requirement.
   */
  private async _authorizeStage7Approval(
    projectId: string,
    userId: string,
    userRole: string | undefined,
    schema: IProjectSchema,
  ): Promise<void> {
    const project = await this.projectRepo.findById(projectId);
    if (!project) throw new AppError('Project not found', StatusCodes.NOT_FOUND);

    if (hasAnyRole(userRole, ['SUPER_ADMIN', 'SYSTEM_ADMIN'])) {
      return;
    }

    const approval = schema.stage_7?.approval;
    if (!approval?.approverId) {
      throw new AppError(
        'No approver has been assigned to this proposal yet.',
        StatusCodes.UNPROCESSABLE_ENTITY,
        true,
        { code: ErrorCode.VALIDATION_ERROR },
      );
    }

    if (String(approval.approverId) !== String(userId)) {
      throw new AppError(
        `Only the assigned approver (${approval.approverName ?? 'the assigned Sales Manager'}) can approve this stage.`,
        StatusCodes.FORBIDDEN,
        true,
        { code: ErrorCode.UNAUTHORIZED },
      );
    }

    const finalPrice = this.computeStage7ThresholdPrice(schema);
    const approverUser = await userRepository.findById(userId);
    if (
      !approverUser ||
      !isEligibleApprover({ role: approverUser.role, email: approverUser.email, isActive: approverUser.isActive }, finalPrice)
    ) {
      throw new AppError(
        'You are no longer eligible to approve this proposal at its current price. Ask for it to be reassigned.',
        StatusCodes.FORBIDDEN,
        true,
        { code: ErrorCode.UNAUTHORIZED },
      );
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // AI: PUSH STAGE
  // ───────────────────────────────────────────────────────────────────────────

  // ───────────────────────────────────────────────────────────────────────────
  // STAGE 0: TRIGGER INITIAL AI EXTRACTION
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * CHANGED: no longer takes an IOutlookEmail. Callers now pass:
   *  - documentIds: the SPECIFIC documents that just arrived (not "all active
   *    documents on the project" — that was the old behavior and it caused
   *    re-processing of previously-submitted documents on every new upload).
   *  - source: optional display metadata (subject/fromAddress) — present for
   *    email-originated triggers, absent for Teams/manual-upload triggers —
   *    plus a required correlationId used for Service Bus dedup.
   */
  /**
   * Snapshot of everything written about a project that is not a document: Zoho
   * notes, Teams conversation and mail bodies. Sent with every BEGIN_EXTRACTION
   * so the AI can see what changed since the last run.
   *
   * Capped and truncated on purpose: an Azure Service Bus message is limited to
   * 256 KB on the Standard tier, and a busy channel would blow past that.
   * Newest first, so the cap drops the least relevant items.
   */
  /**
   * Decide which of the Zoho description and notes to send, by diffing the
   * approved snapshot against the one before it.
   *
   * WHY a delta and not the current state: a note that supersedes the
   * description ("now 17x17" against a description still reading 30 panels)
   * used to be sent alongside it, leaving the AI to arbitrate between two
   * contradicting requirements with no rule for doing so. Sending only what
   * changed removes the conflict at source instead of hoping the model
   * resolves it.
   *
   *   previous vs current   ->  notes          description
   *   notes only            ->  newest note    null
   *   description only      ->  []             current
   *   both                  ->  newest note    current
   *   no previous (first)   ->  newest note    current
   *
   * Only a Zoho CRM approval carries the snapshot hash in its correlationId. A
   * document, Teams or manual retrigger is not a CRM event at all and has no
   * "what changed" to speak of, so it keeps receiving the current state of both.
   */
  private _resolveCrmDelta(
    lead: any,
    project: any,
    correlationId: string | null,
  ): { description: string | null; descriptionAt: Date | null; notes: any[] } {
    const ZOHO_CRM_PREFIX = 'zohoCrmContext:';
    const history: any[] = Array.isArray(lead?.noteHistory) ? lead.noteHistory : [];
    const latest = history.length > 0 ? history[history.length - 1] : null;
    const liveDescription = (lead?.description ?? project?.description ?? null) as string | null;
    const live = {
      description: liveDescription,
      // A stamp must never outlive the text it dates: a lead with no description
      // would otherwise ship a timestamp for nothing and invite the AI to treat
      // the absence as a dated fact.
      descriptionAt: liveDescription === null ? null : ProposalService._descriptionAt(latest),
      notes: (Array.isArray(lead?.notes) ? lead.notes : []) as any[],
    };

    if (!correlationId || !correlationId.startsWith(ZOHO_CRM_PREFIX)) return live;
    const hash = correlationId.slice(correlationId.lastIndexOf(':') + 1);
    const index = hash ? history.findIndex((version) => version?.hash === hash) : -1;

    // The approved snapshot has aged out of history, or its predecessor has.
    // Falling back to the current state of both is the safe direction: it can
    // only ever send too much, never the wrong thing.
    if (index <= 0) return index === 0 ? this._crmSnapshotAsSent(history[0]) : live;

    const current = history[index];
    const previous = history[index - 1];
    const currentDescription = (current?.description ?? null) as string | null;
    const currentNotes: any[] = Array.isArray(current?.notes) ? current.notes : [];
    const descriptionChanged = (previous?.description ?? null) !== currentDescription;
    const notesChanged =
      ProposalService._notesFingerprint(previous?.notes) !== ProposalService._notesFingerprint(currentNotes);

    // The hash covers both fields, so reaching here means at least one moved.
    // If neither did, something upstream is wrong and sending both is safest.
    if (!descriptionChanged && !notesChanged) return this._crmSnapshotAsSent(current);

    // The context sends the last note only, so the one this change added or edited goes last.
    const changedNote = notesChanged ? latestChangedNote(previous?.notes, currentNotes) : null;
    return {
      description: descriptionChanged ? currentDescription : null,
      descriptionAt:
        descriptionChanged && currentDescription !== null ? ProposalService._descriptionAt(current) : null,
      notes: !notesChanged ? [] : changedNote ? [...currentNotes.filter((note) => note !== changedNote), changedNote] : currentNotes,
    };
  }

  /** A whole snapshot, sent as-is: used for the first version and as a fallback. */
  private _crmSnapshotAsSent(version: any): { description: string | null; descriptionAt: Date | null; notes: any[] } {
    const description = (version?.description ?? null) as string | null;
    return {
      description,
      descriptionAt: description === null ? null : ProposalService._descriptionAt(version),
      notes: Array.isArray(version?.notes) ? version.notes : [],
    };
  }

  /**
   * When the description on a snapshot last changed. Prefers Zoho's own clock,
   * falling back to when we captured the snapshot: history written before this
   * field existed has no stamp, and the capture time still dates the change to
   * within one sync interval, which beats telling the AI nothing.
   */
  private static _descriptionAt(version: any): Date | null {
    return (version?.descriptionChangedAt ?? version?.capturedAt ?? null) as Date | null;
  }

  /**
   * Identity of a note set for change detection. Includes modifiedTime so an
   * EDIT to existing text counts as a change, not just an added note.
   */
  private static _notesFingerprint(notes: any): string {
    return JSON.stringify(
      (Array.isArray(notes) ? notes : []).map((n) => [
        n?.noteId ?? '',
        n?.content ?? '',
        n?.modifiedTime ? new Date(n.modifiedTime).getTime() : 0,
      ]),
    );
  }

  private async collectProjectContext(
    projectId: string,
    changeSummary: string | null,
    // Only a Zoho CRM approval names the exact snapshot it was raised for, which
    // is what makes the description/notes delta below possible.
    correlationId: string | null = null,
    // What raised this run (ZOHO, TEAMS, EMAIL, ...), so the AI can tell the
    // approved instruction apart from background history.
    triggerSource: string | null = null,
  ): Promise<{
    triggerSource: string | null;
    changeSummary: string | null;
    zohoDescription: string | null;
    zohoDescriptionAt: Date | null;
    teamsChatSummaries: string[];
    teamsMeetingSummaries: Array<{ subject?: string | null; summary: string }>;
    zohoNotes: Array<{ content: string; author?: string | null; at?: Date | null }>;
    emails: Array<{ subject?: string | null; from?: string | null; body: string; at?: Date | null }>;
  }> {
    // Latest note only, deliberately, not a truncation cap. Notes supersede each
    // other ("10x10" then "13x13" then "17x17"), and the whole context object is
    // dumped verbatim into the AI's revision prompt, so sending the older ones
    // just hands the model contradicting dimensions to choose between.
    const MAX_NOTES = 1;
    const MAX_EMAILS = 20;
    const MAX_MEETINGS = 20;
    const MAX_CHARS = 4000;
    const truncate = (text?: string | null): string =>
      (text ?? '').length > MAX_CHARS ? `${(text ?? '').slice(0, MAX_CHARS)}…[truncated]` : (text ?? '');

    const empty = {
      triggerSource,
      changeSummary,
      zohoDescription: null,
      zohoDescriptionAt: null,
      teamsChatSummaries: [],
      teamsMeetingSummaries: [],
      zohoNotes: [],
      emails: [],
    };
    if (!mongoose.Types.ObjectId.isValid(projectId)) return empty;
    const projectObjectId = new mongoose.Types.ObjectId(projectId);

    try {
      const project = typeof this.projectRepo?.findById === 'function' ? await this.projectRepo.findById(projectId) : null;

      const getZohoLead = async () => {
        try {
          const model: any = mongoose.model('ZohoLead');
          if (typeof model?.findOne !== 'function') return null;
          return await model
            .findOne({
              $or: [
                { projectId: projectObjectId },
                ...(project?.zohoLeadId ? [{ zohoLeadId: project.zohoLeadId }] : []),
                ...(project?.referenceNumber ? [{ quoteNumber: project.referenceNumber }] : []),
              ],
            })
            // noteHistory is needed to diff this snapshot against the one before
            // it. Retriggers are human-approved and rare, so the extra read is
            // paid once per approval, not on any hot path.
            .select('description notes noteHistory')
            .lean();
        } catch {
          return null;
        }
      };

      const getEmails = async () => {
        try {
          const model: any = mongoose.model('OutlookEmail');
          if (typeof model?.find !== 'function') return [];
          return await model
            .find({ projectId: projectObjectId })
            .sort({ receivedDateTime: -1 })
            .limit(MAX_EMAILS)
            .select('subject fromAddress bodyText receivedDateTime')
            .lean();
        } catch {
          return [];
        }
      };

      const getChannels = async () => {
        try {
          const model: any = mongoose.model('TeamsMonitoredChannel');
          if (typeof model?.find !== 'function') return [];
          return await model
            .find({ $or: [{ projectIds: projectObjectId }, { projectId: projectObjectId }] })
            .select('aiChatSummary')
            .lean();
        } catch {
          return [];
        }
      };

      const getMeetings = async () => {
        try {
          const model: any = mongoose.model('TeamsMeeting');
          if (typeof model?.find !== 'function') return [];
          return await model
            .find({ projectId: projectObjectId })
            .sort({ startDateTime: -1 })
            .limit(MAX_MEETINGS)
            .select('subject aiSummary')
            .lean();
        } catch {
          return [];
        }
      };

      const [lead, emails, channels, meetings] = await Promise.all([
        getZohoLead(),
        getEmails(),
        getChannels(),
        getMeetings(),
      ]);

      const crm = this._resolveCrmDelta(lead, project, correlationId);

      return {
        triggerSource,
        changeSummary: truncate(changeSummary) || null,
        zohoDescription: truncate(crm.description) || null,
        zohoDescriptionAt: crm.descriptionAt,
        teamsChatSummaries: (channels as any[])
          .map((channel) => truncate(channel.aiChatSummary?.summary))
          .filter((summary) => summary.length > 0),
        teamsMeetingSummaries: (meetings as any[])
          .filter((meeting) => (meeting.aiSummary?.summary ?? '').trim().length > 0)
          .map((meeting) => ({ subject: meeting.subject ?? null, summary: truncate(meeting.aiSummary.summary) })),
        zohoNotes: crm.notes
          .slice(-MAX_NOTES)
          .map((note) => ({
            content: truncate(note.content),
            author: note.author ?? null,
            at: note.modifiedTime ?? note.createdTime ?? null,
          })),
        emails: (emails as any[])
          .filter((email) => (email.bodyText ?? '').trim().length > 0)
          .map((email) => ({
            subject: email.subject ?? null,
            from: email.fromAddress ?? null,
            body: truncate(email.bodyText),
            at: email.receivedDateTime ?? null,
          })),
      };
    } catch (err) {
      // Context is additive. Losing it must never stop the extraction itself.
      console.error(`[Stage 0] Failed to collect project context for ${projectId}:`, err);
      return empty;
    }
  }

  /** The approved text of a text-driven retrigger still awaiting its AI result, if any. */
  private async _activeRetriggerInstruction(projectId: string): Promise<string | null> {
    const project = typeof this.projectRepo?.findById === 'function' ? await this.projectRepo.findById(projectId) : null;
    return liveRetriggerInstruction(project?.activeRetrigger ?? null);
  }

  /**
   * Active documents in scope for a Stage 0 run. `listed` returns only the
   * named documents (none when none are named); `listed-or-all` falls back to
   * every active document when none are named or found.
   */
  private async _loadExtractionDocuments(
    projectId: string,
    documentIds: string[],
    scope: ExtractionDocumentScope,
  ): Promise<any[]> {
    const Document = mongoose.model('Document');
    const projectObjectId = new mongoose.Types.ObjectId(projectId);
    const listedIds = (documentIds ?? [])
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));

    if (listedIds.length > 0) {
      const listed = await Document.find({ _id: { $in: listedIds }, projectId: projectObjectId, isActive: true }).lean() as any[];
      if (listed.length > 0 || scope === 'listed') return listed;
    } else if (scope === 'listed') {
      return [];
    }
    return await Document.find({ projectId: projectObjectId, isActive: true }).lean() as any[];
  }

  public async triggerStage0Extraction(
    projectId: string,
    documentIds: string[],
    source: {
      subject?: string;
      fromAddress?: string;
      correlationId: string;
      // The approved summary, forwarded verbatim so the AI is told what changed.
      summary?: string | null;
      // What raised this run (an approval source such as ZOHO, or MANUAL).
      origin?: string | null;
    },
    // Only the "a new file just arrived" path may bail out when every document
    // already has a cached AI result. Every other caller is a RE-trigger: the
    // documents are deliberately unchanged and the new context (an approved mail,
    // Zoho note, Teams summary, or an explicit click) is what must be re-read.
    // Defaults to false so a new caller cannot silently inherit the skip.
    // `documentScope: 'listed'` sends only the named documents (approvals).
    options?: { skipIfAllCached?: boolean; documentScope?: ExtractionDocumentScope }
  ): Promise<void> {
    // 1. Ensure the Proposal schema exists in the DB so the AI has a target to update
    await this.proposalRepo.ensureProposalExists(projectId);

    // 2. Load the documents in scope, then keep back what the AI must not read:
    // generated proposals and spreadsheets.
    const documents = await this._loadExtractionDocuments(projectId, documentIds, options?.documentScope ?? 'listed-or-all');
    const { sendable, excluded } = partitionAiDocuments(documents);
    if (excluded.length > 0) {
      console.log(
        `[Stage 0] Not sending ${excluded.length} document(s) the AI cannot use for project ${projectId}: ` +
          excluded.map(({ document, reason }) => `${document.originalName} (${reason})`).join(', '),
      );
    }

    // 3. Filter out cached documents for payloadDocs so old PDFs/PNGs are NOT re-parsed by Vision/Azure DI.
    // Only new (uncached) documents are passed to the AI document queue.
    const uncachedDocs = sendable.filter((doc) => !doc.cachedAiResultRef);
    const skippedCachedCount = sendable.length - uncachedDocs.length;

    if (skippedCachedCount > 0) {
      console.log(
        `[Deduplication] Skipping ${skippedCachedCount} cached documents for project ${projectId}`
      );
    }

    // If skipIfAllCached is set (background upload) and there are no new docs, return early.
    if (options?.skipIfAllCached && uncachedDocs.length === 0) {
      console.log(
        `[Deduplication] All documents have cached AI results for project ${projectId}, skipping AI processing`
      );
      return;
    }

    // 4. Mint fresh 60-minute SAS URLs for ONLY uncached (new) documents.
    // For text-only retriggers (Zoho/Teams/manual), uncachedDocs is [] so payloadDocs is []
    // and the AI receives documents: [] (0 docs to parse with Vision/Azure DI).
    const payloadDocs = await Promise.all(
      uncachedDocs.map(async (doc) => {
        let sasUrl = doc.blobUrl; // Fallback
        if (doc.storageKey) {
          sasUrl = await this.blobStorage.createSignedDownloadUrl(doc.storageKey, 60);
        }
        return {
          documentId: String(doc._id),
          originalName: doc.originalName,
          blobUrl: sasUrl,
        };
      })
    );

    // 4. Collect the written context. A re-trigger is usually caused by TEXT
    // changing, not files: a Zoho note, a Teams summary, a new mail. Without this
    // the AI only ever receives the drawings and re-reads them unchanged, so an
    // approved change cannot alter the outcome.
    const context = await this.collectProjectContext(
      projectId,
      source.summary ?? null,
      source.correlationId ?? null,
      source.origin ?? null,
    );

    // Guard: if there's nothing to send — no documents and no textual context —
    // don't publish to the queue at all. The AI will immediately dead-letter such
    // a message as NO_DOCUMENTS (permanent failure), leaving the project stuck in
    // PROCESSING forever. Instead, leave analysisStatus as NOT_STARTED so the
    // frontend shows "waiting for uploads" and the estimator can upload files.
    const hasContext = !!(
      context?.changeSummary ||
      context?.zohoDescription ||
      (context?.zohoNotes?.length ?? 0) > 0 ||
      (context?.emails?.length ?? 0) > 0 ||
      (context?.teamsChatSummaries?.length ?? 0) > 0 ||
      (context?.teamsMeetingSummaries?.length ?? 0) > 0
    );
    if (payloadDocs.length === 0 && !hasContext) {
      console.log(
        `[Stage 0] Skipping queue publish for project ${projectId}: no documents and no context. ` +
        `Project will stay in NOT_STARTED until documents are uploaded.`,
      );
      // Reset to NOT_STARTED so the frontend doesn't show a spinning "Processing" indicator
      await this.projectRepo.updateById(projectId, {
        analysisStatus: ProjectAnalysisStatus.NOT_STARTED,
      });
      return;
    }

    // Saved before publishing so it is in place when the AI answers; any other
    // kind of run clears it, so an old approval can never authorise it.
    await this.projectRepo.updateById(projectId, {
      activeRetrigger: buildActiveRetrigger(source.origin, source.correlationId, context),
    });

    // 5. Publish to the Service Bus Queue
    await this.triggerPublisher.publishExtraction({
      trigger: 'BEGIN_EXTRACTION',
      jobType: 'PROJECT_EXTRACTION',
      projectId,
      correlationId: source.correlationId,
      payload: {
        subject: source.subject || 'New Project',
        sender: source.fromAddress || 'unknown',
        documents: payloadDocs,
        context
      }
    });

    // 5. Update Master Project Status to signal it is currently with the AI
    // analysisStatus completes a lifecycle the AI webhook already finishes with
    // COMPLETED/FAILED but nothing ever started. The workspace reads it to show
    // that analysis is running, so without it an approved change looks inert even
    // when the job is on the queue.
    await this.projectRepo.updateById(projectId, {
      status: ProjectStatus.WAITING_FOR_INPUTS,
      analysisStatus: ProjectAnalysisStatus.PROCESSING,
    });
    await this.recordAnalysisAudit(projectId, ProjectAnalysisStatus.PROCESSING);

    try {
      const project = await this.projectRepo.findById(projectId);
      if (project) {
        const estimatorIds = (project.assignedEstimators ?? [])
          .map((est: any) => (est && typeof est === 'object' ? (est._id || est.id) : est))
          .filter(Boolean)
          .map((id: any) => String(id))
          .filter((id: string) => require('mongoose').Types.ObjectId.isValid(id));
        await notificationService.notifyProjectProcessing({
          projectId,
          referenceNumber: project.referenceNumber,
          projectName: project.projectName,
          estimatorIds
        });
      }
    } catch (e) {
      console.error('[Stage 0] Failed to send docs processing notification:', e);
    }
    
    console.log(`\n======================================================`);
    console.log(`🚀 [Stage 0 Extraction] Dispatched extraction trigger to Azure Service Bus!`);
    console.log(`Project ID: ${projectId} | Documents: ${payloadDocs.length}`);
    console.log(`Correlation ID: ${source.correlationId}`);
    console.log(`Payload Docs: ${payloadDocs.map(d => d.originalName).join(', ')}`);
    console.log(`======================================================\n`);
  }

  private _approveFieldsRecursively(obj: any): void {
    if (typeof obj !== 'object' || obj === null) return;
    if ('status' in obj && typeof obj.status === 'string' && obj.status !== 'APPROVED') {
      obj.status = 'APPROVED';
    }
    for (const key of Object.keys(obj)) {
      if (key === '_feedback' || key === '_signals' || key === '_meta') continue;
      this._approveFieldsRecursively(obj[key]);
    }
  }

  /**
   * Applies re-ingested Excel data to the proposal schema, marks all stages (1 to 7) as APPROVED,
   * generates a final proposal Excel quote (bumping revision), updates project status to completed/packaged,
   * and syncs the revised quote back to Dropbox.
   */
  public async applyExcelReingestion(
    projectId: string,
    parsedData: ParsedProposalData,
    _documentId: string,
    userId: string
  ): Promise<{ nextSchema: IProjectSchema; changedFieldPaths: string[]; newFinalPrice: number | null }> {
    await this.proposalRepo.ensureProposalExists(projectId);
    const currentSchema = await this.proposalRepo.getCurrentSchema(projectId);

    const { nextSchema, changedFieldPaths, newFinalPrice } = excelIngestionService.applyParsedDataToSchema(
      currentSchema,
      parsedData
    );

    // 1. Mark every stage (1 to 7) as APPROVED in pipeline_status
    if (!nextSchema.pipeline_status) {
      nextSchema.pipeline_status = {} as any;
    }
    nextSchema.pipeline_status.stage_1_status = 'APPROVED';
    nextSchema.pipeline_status.stage_2_status = 'APPROVED';
    nextSchema.pipeline_status.stage_3_status = 'APPROVED';
    nextSchema.pipeline_status.stage_4_status = 'APPROVED';
    nextSchema.pipeline_status.stage_5_status = 'APPROVED';
    nextSchema.pipeline_status.stage_6_status = 'APPROVED';
    nextSchema.pipeline_status.stage_7_status = 'APPROVED';

    // Recursively mark all fields across stages 1-7 and units as APPROVED
    this._approveFieldsRecursively(nextSchema.stage_1);
    this._approveFieldsRecursively(nextSchema.stage_2);
    this._approveFieldsRecursively(nextSchema.stage_3);
    this._approveFieldsRecursively(nextSchema.stage_4);
    this._approveFieldsRecursively(nextSchema.stage_5);
    this._approveFieldsRecursively(nextSchema.stage_6);
    this._approveFieldsRecursively(nextSchema.stage_7);
    this._approveFieldsRecursively(nextSchema.units);

    // 2. Generate and persist the final proposal Excel revision (bumping revision letter and scheduling Dropbox sync)
    const generated = await this._generateAndPersistProposalExcel(
      projectId,
      nextSchema,
      userId || 'system'
    );

    const finalSchema = generated.nextSchema;
    if (!finalSchema.pipeline_status) {
      finalSchema.pipeline_status = {} as any;
    }
    finalSchema.pipeline_status.stage_1_status = 'APPROVED';
    finalSchema.pipeline_status.stage_2_status = 'APPROVED';
    finalSchema.pipeline_status.stage_3_status = 'APPROVED';
    finalSchema.pipeline_status.stage_4_status = 'APPROVED';
    finalSchema.pipeline_status.stage_5_status = 'APPROVED';
    finalSchema.pipeline_status.stage_6_status = 'APPROVED';
    finalSchema.pipeline_status.stage_7_status = 'APPROVED';
    if (finalSchema.stage_7) {
      finalSchema.stage_7.status = 'APPROVED';
    }

    const finalPriceToUse = finalSchema.stage_7?.computed_snapshot?.grand_total
      ?? this.computeProposalPrice(finalSchema)
      ?? newFinalPrice;

    // 3. Append approved version
    await this.proposalRepo.appendVersion({
      projectId,
      nextSchema: finalSchema,
      changedFieldPaths: [
        ...changedFieldPaths,
        'pipeline_status',
        'stage_1',
        'stage_2',
        'stage_3',
        'stage_4',
        'stage_5',
        'stage_6',
        'stage_7',
      ],
      source: 'ESTIMATOR',
      updatedBy: userId || 'system',
      stage: 7,
      approvalStatus: 'APPROVED',
    });

    if (finalPriceToUse !== null && finalPriceToUse > 0) {
      await this.projectRepo.updateById(projectId, {
        estimatedCost: finalPriceToUse,
      });
    }

    // 4. Mark project workflow completed (ADMIN_PACKAGING)
    await this._markProjectCompleted(projectId, userId || 'system', finalSchema);

    // 5. Emit event for SSE/clients
    proposalEventBus.emit(ProposalEvent.STAGE_APPROVED, {
      projectId,
      data: { stage: 7, status: 'APPROVED' },
    });

    console.log(
      `[ProposalService] Applied Excel re-ingestion, approved all stages (1-7), minted new quote revision ${generated.quoteNumber} (${generated.fileName}), and scheduled Dropbox sync for project ${projectId}. Final price: ${finalPriceToUse}`
    );

    return { nextSchema: finalSchema, changedFieldPaths, newFinalPrice: finalPriceToUse };
  }
  
  async pushStageFromAI(
    projectId: string,
    stage: WorkflowStage,
    fields: FieldPatch[],
    pushedBy: string,
  ): Promise<any> {
    await this.proposalRepo.ensureProposalExists(projectId);
    const currentSchema = await this.proposalRepo.getCurrentSchema(projectId);
    
    this._checkPrerequisite(currentSchema, stage);

    if (stage === 6) {
      currentSchema.stage_6 = { 
        cells: {}, 
        status: currentSchema.stage_6?.status || 'READY_FOR_EXCEL' 
      };
    }

    const { nextSchema, changedFieldPaths } = applyPatches(currentSchema, fields, {
      source: 'AI',
      updatedBy: pushedBy
    });

    (nextSchema.pipeline_status as any)[`stage_${stage}_status`] = 'PENDING';
    if (stage < 7) this._lockStage7IfUpstreamOpen(nextSchema, changedFieldPaths);

    await this.proposalRepo.appendVersion({
      projectId,
      nextSchema,
      changedFieldPaths,
      source: 'AI',
      updatedBy: pushedBy,
      stage
    });

    const fieldsToShow = this._filterFieldsToShow(nextSchema, stage);

    proposalEventBus.emit(ProposalEvent.STAGE_PUSHED, {
      projectId,
      data: { stage, fields_to_show: fieldsToShow },
    });

    return { stage, status: 'PENDING_APPROVAL', fields_to_show: fieldsToShow };
  }

  async pushDeepSchemaFromAI(
    projectId: string,
    stage: WorkflowStage | 0,
    deepPayload: any,
    pushedBy: string,
  ): Promise<any> {
    await this.proposalRepo.ensureProposalExists(projectId);
    const currentSchema = await this.proposalRepo.getCurrentSchema(projectId);
    
    if (stage > 0) {
      this._checkPrerequisite(currentSchema, stage as WorkflowStage);
    }

    const nextSchema = structuredClone(currentSchema);
    const changedFieldPaths: string[] = [];

    // Only a full re-extraction (stage 0) may revisit work a human already owns:
    // it means the documents/notes/mail behind the project actually changed, and
    // it reopens every approved stage it moves (below) so a human re-reviews.
    // A stage-1..6 run is just the pipeline re-deriving from unchanged inputs.
    const isReExtraction = stage === 0;

    // Fields a human typed. `_meta` is never written by this merge, so the marker
    // outlives every "revise stage" (which clears the APPROVED status the guard
    // further down keys on) and every AI re-run.
    const humanOwnedSkipped: string[] = [];

    const deepMergeSchema = (target: any, source: any, currentPath: string = '') => {
      if (typeof source !== 'object' || source === null) return;

      // Unit rows are one flat node per unit rather than one IBaseField per
      // field, so a bare `human_override` boolean on the unit would protect
      // every field on it — including AI-only fields (value_description,
      // value_man_hours) the estimator never touched. Units instead list
      // exactly which of their own field names were hand-edited
      // (human_override_fields); when present, that list — not the blanket
      // flag — decides protection for this node's children.
      const fieldLevelProtection: Set<string> | null = Array.isArray(target?._meta?.human_override_fields)
        ? new Set<string>(target._meta.human_override_fields)
        : null;

      for (const key of Object.keys(source)) {
        // _feedback is estimator-authored beta data; an AI re-push must never clobber it.
        if (key === '_meta' || key === '_feedback' || key === 'pipeline_status' || key === 'project_id' || key === 'schema_version' || key === 'created_at' || key === 'updated_at') continue;

        const newPath = currentPath ? `${currentPath}.${key}` : key;
        const humanOwned = fieldLevelProtection
          ? fieldLevelProtection.has(key)
          : target?.[key]?._meta?.human_override === true;

        // Hold the human's answer against a stage re-run. For a standard
        // IBaseField node the whole node is held, not just `value`: the AI's
        // reasoning, confidence and flags describe the value IT picked, so
        // keeping them beside a value it did not pick is what produced
        // "MANUAL" rows still explaining a different reading. For a unit
        // field, only that one field name is held — see fieldLevelProtection.
        if (humanOwned && !isReExtraction) {
          humanOwnedSkipped.push(newPath);
          continue;
        }

        if (Array.isArray(source[key])) {
          target[key] = source[key];
          changedFieldPaths.push(newPath);
        } else if (typeof source[key] === 'object' && source[key] !== null) {
          if (!target[key]) target[key] = {};
          const before = humanOwned ? JSON.stringify(this._collectFieldValues(target[key], newPath)) : null;
          deepMergeSchema(target[key], source[key], newPath);
          // A re-extraction that actually moves the value makes the marker a lie:
          // the stored value is no longer the one the human chose, so drop it.
          if (humanOwned && JSON.stringify(this._collectFieldValues(target[key], newPath)) !== before) {
            delete target[key]._meta.human_override;
            delete target[key]._meta.human_override_at;
            delete target[key]._meta.human_override_by;
          }
        } else {
          const before = humanOwned && fieldLevelProtection ? JSON.stringify(target[key] ?? null) : null;
          target[key] = source[key];
          changedFieldPaths.push(newPath);
          // Same staleness rule as above, but for one field name in the unit's
          // own protection list rather than the whole node's blanket flag.
          if (humanOwned && fieldLevelProtection && JSON.stringify(target[key] ?? null) !== before) {
            fieldLevelProtection.delete(key);
            target._meta.human_override_fields = Array.from(fieldLevelProtection);
          }
        }
      }
    };

    if (stage === 6) {
      // Only reset when this push actually carries a fresh stage_6 block.
      // A proposal-only push (stage_6_proposal without stage_6) must not wipe
      // the already-persisted Pricing Worksheet cells.
      if (deepPayload && typeof deepPayload === 'object' && 'stage_6' in deepPayload) {
        nextSchema.stage_6 = {
          cells: {},
          status: nextSchema.stage_6?.status || 'READY_FOR_EXCEL'
        };
      }
    }

    // A stage-N run is authoritative for stage N only. Its payload routinely
    // echoes the AI's whole canonical schema, so applying every block it carries
    // let a downstream run silently rewrite a stage the estimator had already
    // approved (the value reverted, while pipeline_status kept saying APPROVED
    // because deepMergeSchema skips it). Only a full re-extraction (stage 0),
    // which is what a Teams/Zoho/document retrigger produces, may revisit an
    // approved stage, and it has to reopen it (below).
    const stageStatusOf = (n: number): string =>
      (currentSchema.pipeline_status as any)?.[`stage_${n}_status`];

    const scopedPayload: any = {};
    const blockedStages: number[] = [];
    for (const key of Object.keys(deepPayload ?? {})) {
      const owner = this._ownerStageOfSchemaKey(key);
      if (owner !== null && owner !== stage && !isReExtraction && stageStatusOf(owner) === 'APPROVED') {
        blockedStages.push(owner);
        continue;
      }
      scopedPayload[key] = structuredClone(deepPayload[key]);
    }
    if (blockedStages.length > 0) {
      console.warn(
        `[ProposalService] Stage ${stage} push for project ${projectId} also carried ` +
          `stage(s) ${[...new Set(blockedStages)].join(', ')}, which are APPROVED. Ignored: ` +
          `only a re-extraction may change an approved stage.`,
      );
    }

    // The AI callback bypasses applyPatches(), so its frame values must be
    // guarded here before the deep merge. In particular, labels such as
    // "MODIFIED_SERIES_1000" are not selectable GFS frame types and must not
    // become persisted project data merely because they appeared in an AI run.
    const discardedFramePaths: string[] = [];
    const incomingDecision = scopedPayload.stage_3?.decision;
    const incomingFrameValue = incomingDecision?.frame_type?.value;
    if (incomingFrameValue !== null && incomingFrameValue !== undefined && !isCanonicalFrameType(incomingFrameValue)) {
      delete incomingDecision.frame_type;
      discardedFramePaths.push('stage_3.decision.frame_type', ...dropFrameDerivedFields(scopedPayload.stage_3));
    }

    // Unit values are checked against the same contract as the stage webhook,
    // so free text never becomes a stored glass/frame/crossbeam/status.
    const discardedUnitPaths = dropInvalidUnitFields(scopedPayload);

    const existingFrameType = currentSchema.stage_3?.decision?.frame_type?.value;
    const incomingFrameType = scopedPayload.stage_3?.decision?.frame_type?.value;
    const incomingFrameSignal = scopedPayload.stage_3?._signals?.frame_type_stated;

    // A different frame family has a material pricing impact. Keep the saved
    // selection unless a document cites the new family or the change the
    // estimator approved names it (a Zoho note, Teams summary or email).
    if (
      isCanonicalFrameType(existingFrameType) &&
      isCanonicalFrameType(incomingFrameType) &&
      frameFamilyOf(existingFrameType) !== frameFamilyOf(incomingFrameType) &&
      !hasCitedStatedFrameFamily(incomingFrameSignal, incomingFrameType) &&
      !instructionNamesFrameFamily(isReExtraction ? await this._activeRetriggerInstruction(projectId) : null, incomingFrameType)
    ) {
      delete scopedPayload.stage_3.decision.frame_type;
      const derived = dropFrameDerivedFields(scopedPayload.stage_3);
      console.warn(
        `[ProposalService] Ignored unsupported AI frame-family change for project ${projectId}: ` +
          `${existingFrameType} -> ${incomingFrameType}. Neither a cited document nor the approved change names it` +
          (derived.length > 0 ? `; also ignored ${derived.join(', ')}` : '') + '.',
      );
    }

    if (discardedFramePaths.length > 0) {
      console.warn(
        `[ProposalService] Ignored invalid AI frame value(s) for project ${projectId}: ${discardedFramePaths.join(', ')}`,
      );
    }
    if (discardedUnitPaths.length > 0) {
      console.warn(
        `[ProposalService] Ignored invalid AI unit value(s) for project ${projectId}: ${discardedUnitPaths.join(', ')}`,
      );
    }

    // AI/CRM sources may provide several contact numbers as an array or a
    // delimited string. Keep the existing scalar schema contract, but store
    // every number in one canonical newline-separated value.
    const canonicalizeContactPhone = (payload: any): void => {
      const candidates = [
        { parent: payload?.stage_1, value: payload?.stage_1?.contact_phone },
        ...(stage === 1 ? [{ parent: payload, value: payload?.contact_phone }] : []),
      ];
      for (const { parent, value: candidate } of candidates) {
        if (candidate === undefined) continue;
        if (candidate && typeof candidate === 'object' && !Array.isArray(candidate) && 'value' in candidate) {
          candidate.value = normalizePhoneValue(candidate.value);
          if ('extracted_value' in candidate) {
            candidate.extracted_value = normalizePhoneValue(candidate.extracted_value);
          }
        } else if (parent && typeof parent === 'object') {
          parent.contact_phone = normalizePhoneValue(candidate);
        }
      }
    };
    canonicalizeContactPhone(scopedPayload);

    // Stage 5 carries per-unit calculated values (man-hours, sqft, weight, packaging,
    // perimeter, silicone — AI contract §2b) inside `units`. `units` is
    // owned by Stage 4, so the scoping below would drop the whole map once
    // Stage 4 is APPROVED — which it always is when Stage 5 runs — and the
    // per-unit calcs would never persist. Merge the calculated-only keys
    // directly: they are AI-derived display values, never part of the
    // Stage 4 approval, and must neither be dropped nor reopen Stage 4.
    // Human-edited unit fields stay protected via human_override_fields
    // inside deepMergeSchema below.
    const STAGE5_UNIT_CALC_KEYS = [
      'value_man_hours',
      'value_packaging',
      'value_calculated_sqft',
      'value_outer_width_in',
      'value_outer_length_in',
      'value_perimeter_lf',
      'value_rafter_lf',
      'value_calculated_weight_lbs',
      'value_silicone_tubes',
      // Rule 7 per-unit proposal line (Proposal sheet J23:J32). Generated in
      // Stage 5 alongside the calcs, so it rides the same carve-out; an
      // estimator-edited description is held by human_override_fields.
      'value_description',
      'generated_desc_at',
    ];
    let stage5UnitCalcs: Record<string, any> | null = null;
    if (stage === 5 && deepPayload && typeof (deepPayload as any).units === 'object'
        && (deepPayload as any).units !== null && !Array.isArray((deepPayload as any).units)) {
      stage5UnitCalcs = {};
      for (const [unitKey, unit] of Object.entries((deepPayload as any).units as Record<string, any>)) {
        if (!unit || typeof unit !== 'object' || Array.isArray(unit)) continue;
        const picked: Record<string, unknown> = {};
        for (const k of STAGE5_UNIT_CALC_KEYS) {
          if ((unit as Record<string, unknown>)[k] !== undefined) {
            picked[k] = (unit as Record<string, unknown>)[k];
          }
        }
        if (Object.keys(picked).length > 0) {
          (stage5UnitCalcs as Record<string, any>)[unitKey] = picked;
        }
      }
      if (Object.keys(stage5UnitCalcs as Record<string, any>).length === 0) {
        stage5UnitCalcs = null;
      } else {
        delete (deepPayload as any).units;
      }
    }

    // Snapshot the values of every stage this push may touch so the reopen and
    // history decisions below rest on real changes, not on the AI re-sending
    // identical data (which it does on every run).
    const valuesBefore = new Map<string, Record<string, string>>();
    for (const key of Object.keys(scopedPayload)) {
      if (this._ownerStageOfSchemaKey(key) === null) continue;
      valuesBefore.set(key, this._collectFieldValues((nextSchema as any)[key], key));
    }
    // A re-extraction may move a single unit's specs below even when it sent no units.
    if (isReExtraction && !valuesBefore.has('units')) {
      valuesBefore.set('units', this._collectFieldValues(nextSchema.units, 'units'));
    }

    deepMergeSchema(nextSchema, scopedPayload);

    if (isReExtraction) {
      changedFieldPaths.push(...syncSingleUnitSpecsFromProject(currentSchema, nextSchema));
    }

    if (stage5UnitCalcs) {
      if (!nextSchema.units) nextSchema.units = {};
      for (const [unitKey, picked] of Object.entries(stage5UnitCalcs)) {
        if (!nextSchema.units[unitKey]) {
          nextSchema.units[unitKey] = { unit_id: unitKey } as any;
        }
        deepMergeSchema(nextSchema.units[unitKey], picked, `units.${unitKey}`);
      }
    }

    // Stage 6 re-emits each unit's fabrication hours as Pricing Worksheet row
    // 71 (E71 = Unit A, H71 = Unit B, ...). Back-fill them onto units that have
    // none, so Parameters / Final Parameters / the Excel writer — which all
    // read units.X.value_man_hours — see the same hours the AI priced. Only
    // fills gaps: an existing value (AI Stage 5 or estimator) is never replaced.
    if (stage === 6 && scopedPayload.stage_6?.cells && typeof scopedPayload.stage_6.cells === 'object') {
      for (const [address, raw] of Object.entries(scopedPayload.stage_6.cells as Record<string, unknown>)) {
        const unitKey = unitKeyForManHoursCell(address);
        const hours = toFiniteNumber(raw);
        const unit = unitKey ? nextSchema.units?.[unitKey] : undefined;
        if (!unit || hours === null || hours <= 0) continue;
        if (toFiniteNumber(unit.value_man_hours) !== null) continue;
        if (isUnitFieldHumanHeld(unit, 'value_man_hours')) continue;
        unit.value_man_hours = hours;
        changedFieldPaths.push(`units.${unitKey}.value_man_hours`);
      }
    }

    // Same back-fill for packaging: Pricing Worksheet row 73.
    if (stage === 6 && scopedPayload.stage_6?.cells && typeof scopedPayload.stage_6.cells === 'object') {
      for (const [address, raw] of Object.entries(scopedPayload.stage_6.cells as Record<string, unknown>)) {
        const unitKey = unitKeyForPackagingCell(address);
        const packaging = toFiniteNumber(raw);
        const unit = unitKey ? nextSchema.units?.[unitKey] : undefined;
        if (!unit || packaging === null || packaging <= 0) continue;
        if (toFiniteNumber(unit.value_packaging) !== null) continue;
        if (isUnitFieldHumanHeld(unit, 'value_packaging')) continue;
        unit.value_packaging = packaging;
        changedFieldPaths.push(`units.${unitKey}.value_packaging`);
      }
    }

    if (humanOwnedSkipped.length > 0) {
      console.warn(
        `[ProposalService] Stage ${stage} push for project ${projectId} tried to overwrite ` +
          `human-set field(s) ${humanOwnedSkipped.join(', ')}. Kept the human value: only a ` +
          `re-extraction or another human edit may change it.`,
      );
    }

    const changedPathsByStage = new Map<number, string[]>();
    for (const [key, before] of valuesBefore) {
      const after = this._collectFieldValues((nextSchema as any)[key], key);
      const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])]
        .filter((path) => before[path] !== after[path]);
      if (changed.length === 0) continue;
      const owner = this._ownerStageOfSchemaKey(key) as number;
      changedPathsByStage.set(owner, [...(changedPathsByStage.get(owner) ?? []), ...changed]);
    }

    // If a specific stage is provided, set it to PENDING. If stage 0, maybe set stage 1 to PENDING?
    if (stage > 0) {
      (nextSchema.pipeline_status as any)[`stage_${stage}_status`] = 'PENDING';
    } else {
      nextSchema.pipeline_status.extraction_complete = true;
      nextSchema.pipeline_status.stage_1_status = 'PENDING';
    }

    // Reopen every approved stage whose values this re-extraction actually
    // changed, so the estimator re-reviews it instead of the workspace showing
    // an APPROVED badge over a value nobody signed off on. Downstream stages are
    // left alone: approving a stage already re-marks the next one PENDING, so the
    // walk-forward covers them without locking work the estimator can still see.
    const reopenedStages: number[] = [];
    for (const affectedStage of [...changedPathsByStage.keys()].sort((a, b) => a - b)) {
      if (affectedStage === stage) continue;
      if (stageStatusOf(affectedStage) !== 'APPROVED') continue;
      (nextSchema.pipeline_status as any)[`stage_${affectedStage}_status`] = 'PENDING';
      this._invalidateStageFields((nextSchema as any)[`stage_${affectedStage}`]);
      if (affectedStage === 4) this._invalidateStageFields(nextSchema.units);
      changedFieldPaths.push(`pipeline_status.stage_${affectedStage}_status`);
      reopenedStages.push(affectedStage);
    }
    if (reopenedStages.length > 0) {
      console.warn(
        `[ProposalService] Re-extraction changed approved stage(s) ${reopenedStages.join(', ')} ` +
          `on project ${projectId}; reopened for re-approval.`,
      );
    }

    if (stage < 7) this._lockStage7IfUpstreamOpen(nextSchema, changedFieldPaths);

    const primaryStage = stage === 0 ? 1 : stage;
    await this.proposalRepo.appendVersion({
      projectId,
      nextSchema,
      changedFieldPaths,
      source: 'AI',
      updatedBy: pushedBy,
      stage: primaryStage
    });

    // appendVersion only snapshots the bucket it is given, so a push that changed
    // other stages used to leave no trace in their history at all. Record one
    // version per collaterally changed stage.
    for (const affectedStage of [...changedPathsByStage.keys()].sort((a, b) => a - b)) {
      if (affectedStage === primaryStage) continue;
      await this.proposalRepo.appendVersion({
        projectId,
        nextSchema,
        changedFieldPaths: changedPathsByStage.get(affectedStage) ?? [],
        source: 'AI',
        updatedBy: pushedBy,
        stage: affectedStage as WorkflowStage
      });
    }

    if (stage === 0) {
      // Stage 0 is asynchronous. Mark the project ready and complete the AI
      // lifecycle only after the payload has been persisted successfully. This
      // is the callback used by the extraction worker, so keeping both fields
      // together prevents the workspace from polling forever after a valid
      // Project Header update.
      const updatedProj = await this.projectRepo.updateById(projectId, {
        status: ProjectStatus.READY_FOR_ESTIMATOR,
        analysisStatus: ProjectAnalysisStatus.COMPLETED,
      });
      await this.recordAnalysisAudit(projectId, ProjectAnalysisStatus.COMPLETED, updatedProj?.referenceNumber);
    }

    const stageForReturn = stage === 0 ? 1 : stage;
    const fieldsToShow = this._filterFieldsToShow(nextSchema, stageForReturn);

    proposalEventBus.emit(ProposalEvent.STAGE_PUSHED, {
      projectId,
      data: { stage: stageForReturn, fields_to_show: fieldsToShow },
    });

    if (stage === 0) {
      try {
        const project = await this.projectRepo.findById(projectId);
        if (project) {
          const estimatorIds = (project.assignedEstimators ?? [])
            .map((est: any) => (est && typeof est === 'object' ? (est._id || est.id) : est))
            .filter(Boolean)
            .map((id: any) => String(id))
            .filter((id: string) => require('mongoose').Types.ObjectId.isValid(id));
          await notificationService.notifyProjectProcessed({
            projectId,
            referenceNumber: project.referenceNumber,
            projectName: project.projectName,
            estimatorIds
          });
        }
      } catch (e) {
        console.error('[AI Push] Failed to send docs processed notification:', e);
      }
    }

    return { 
      stage: stageForReturn, 
      status: 'PENDING_APPROVAL', 
      fields_to_show: fieldsToShow 
    };
  }

  async ingestProposalCells(
    projectId: string,
    proposalPayload: { target_sheet?: string; cells: Record<string, string | number | null>; status?: string },
    pushedBy: string = 'AI',
    source: 'AI' | 'ESTIMATOR' = 'AI'
  ): Promise<any> {
    await this.proposalRepo.ensureProposalExists(projectId);
    const currentSchema = await this.proposalRepo.getCurrentSchema(projectId);

    // AI sends { status: "READY_FOR_EXCEL", cells: {...} } with no
    // target_sheet (MD §3/§5.3). Default to the Proposal tab; estimator edits
    // pass it explicitly via updateProposalCells.
    const targetSheet = proposalPayload.target_sheet ?? 'Proposal';
    // Normalize AI's READY_FOR_EXCEL to the proposal-side status vocabulary.
    const rawStatus = proposalPayload.status ?? 'READY_FOR_PROPOSAL_EXCEL';
    const status = rawStatus === 'READY_FOR_EXCEL' ? 'READY_FOR_PROPOSAL_EXCEL' : rawStatus;
    const nextSchema = structuredClone(currentSchema) as IProjectSchema;
    nextSchema.stage_6_proposal = {
      target_sheet: targetSheet,
      cells: { ...(nextSchema.stage_6_proposal?.cells ?? {}), ...proposalPayload.cells },
      status: status as any,
      updated_at: new Date(),
    };

    const changedFieldPaths = ['stage_6_proposal', ...this._syncUnitDescriptionsFromProposalCells(
      currentSchema,
      nextSchema,
      proposalPayload.cells ?? {},
      source,
      pushedBy,
    )];

    await this.proposalRepo.appendVersion({
      projectId,
      nextSchema,
      changedFieldPaths,
      source,
      updatedBy: pushedBy,
      stage: 6,
      versionKey: 'stage_6_proposal',
    });

    return { status: 'ACCEPTED', target_sheet: targetSheet };
  }

  /**
   * Keeps units.X.value_description — the source the Excel/PDF generator
   * writes into Proposal!J23:J32 — in step with the unit-grid description
   * cells, whichever side authored them:
   *
   *   - AI (Stage 6 proposal cells): fill a unit that has no description yet.
   *     The AI builds J{row} from the unit's own value_description, so this
   *     only matters when Stage 5's copy never persisted.
   *   - ESTIMATOR (Edit Draft): the edit becomes the unit's description and is
   *     held against AI Stage 5 re-runs (human_override_fields plus the AI's
   *     own description_manually_edited flag). Without this, the next
   *     generation would stamp the AI wording back over the estimator's.
   */
  private _syncUnitDescriptionsFromProposalCells(
    previousSchema: IProjectSchema,
    nextSchema: IProjectSchema,
    cells: Record<string, string | number | null>,
    source: 'AI' | 'ESTIMATOR',
    updatedBy: string,
  ): string[] {
    const changed: string[] = [];
    for (const [address, raw] of Object.entries(cells)) {
      const unitKey = unitKeyForDescriptionCell(address);
      const unit = unitKey ? nextSchema.units?.[unitKey] : undefined;
      if (!unitKey || !unit) continue;

      if (source === 'AI') {
        if (!isRealDescription(raw)) continue;
        if (isRealDescription(unit.value_description)) continue;
        if (isUnitFieldHumanHeld(unit, 'value_description')) continue;
        unit.value_description = raw.trim();
        changed.push(`units.${unitKey}.value_description`);
        continue;
      }

      // Edit Draft may re-save cells it did not change; only a value that
      // differs from what was on screen counts as the estimator's own wording.
      const next = isRealDescription(raw) ? raw.trim() : null;
      if (next === resolveUnitDescription(previousSchema, unitKey)) continue;
      const fields = Array.isArray(unit._meta?.human_override_fields) ? unit._meta!.human_override_fields : [];
      unit.value_description = next;
      unit.description_manually_edited = true;
      unit._meta = {
        ...(unit._meta ?? {}),
        human_override: undefined,
        human_override_at: new Date().toISOString(),
        human_override_by: updatedBy,
        human_override_fields: Array.from(new Set([...fields, 'value_description'])),
      } as any;
      changed.push(`units.${unitKey}.value_description`);
    }
    return changed;
  }

  async updateProposalCells(
    projectId: string,
    userId: string,
    payload: { target_sheet?: string; cells: Record<string, string | number | null> }
  ): Promise<any> {
    return this.ingestProposalCells(
      projectId,
      {
        target_sheet: payload.target_sheet ?? 'Proposal',
        cells: payload.cells,
      },
      userId,
      'ESTIMATOR'
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  // ESTIMATOR: GET STAGE
  // ───────────────────────────────────────────────────────────────────────────

  private async _resolveUserNames(userIds: string[]): Promise<Record<string, string>> {
    if (userIds.length === 0) return {};
    const users = await mongoose
      .model('User')
      .find({ _id: { $in: userIds } })
      .select('firstName lastName')
      .lean()
      .exec() as Array<{
      _id?: unknown;
      firstName?: string;
      lastName?: string;
    }>;
    return users.reduce<Record<string, string>>((acc, user) => {
      if (user._id) acc[String(user._id)] = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim();
      return acc;
    }, {});
  }
  async getStage(projectId: string, stage: WorkflowStage): Promise<any> {
    let doc = await this.proposalRepo.findByProjectId(projectId);
    if (!doc) {
      const project = await this.projectRepo.findById(projectId);
      if (!project) {
        throw new AppError('Project not found', StatusCodes.NOT_FOUND);
      }
      doc = await this.proposalRepo.ensureProposalExists(projectId);
    }

    const revisionsKey = `stage_${stage}` as keyof typeof doc.revisions;
    const sortedRevisions = [...(doc.revisions?.[revisionsKey] ?? [])].sort(
      (a, b) => b.revisionNumber - a.revisionNumber
    );

    // revisedBy is stored as the estimator's DB id; resolve it to the display name.
    const revisedByIds = [...new Set(sortedRevisions.map((r) => r.revisedBy).filter(Boolean))];
    const revisionAuthors = await this._resolveUserNames(revisedByIds);
    const stageRevisions = sortedRevisions.map((r) => ({
      ...r,
      revisedBy: revisionAuthors[r.revisedBy] ?? r.revisedBy,
    }));

    if (stage === 7 && (!doc.schema.stage_7?.cost_overrides || Object.keys(doc.schema.stage_7.cost_overrides).length === 0)) {
      try {
        await this.initializeStage7(projectId);
        const reloadedSchema = await this.proposalRepo.getCurrentSchema(projectId);
        if (reloadedSchema) {
          doc.schema = reloadedSchema;
        }
      } catch (err) {
        console.error(`[ProposalService] Failed to lazy-initialize Stage 7 for project ${projectId}:`, err);
      }
    }

    if (stage === 7 && (doc.schema?.pipeline_status?.stage_7_status === 'APPROVED' || doc.schema?.stage_7?.status === 'APPROVED')) {
      const project = await this.projectRepo.findById(projectId);
      if (project && project.status !== ProjectStatus.ADMIN_PACKAGING) {
        await this._markProjectCompleted(projectId, 'auto-reconciliation', doc.schema).catch((err) => {
          console.warn(`[ProposalService] Auto-reconciliation of project status failed for ${projectId}:`, err);
        });
      }
    }

    const fieldsToShow = this._filterFieldsToShow(doc.schema, stage);

    // Resolve project documents so citations accurately link to real PDF lead sheets
    let leadDoc: any = null;
    let projectDocs: any[] = [];
    try {
      if (mongoose.connection?.readyState === 1) {
        const pidFilter = mongoose.Types.ObjectId.isValid(projectId)
          ? { $in: [new mongoose.Types.ObjectId(projectId), String(projectId)] }
          : projectId;
        const DocumentModel = mongoose.model('Document');
        projectDocs = (await DocumentModel.find({
          projectId: pidFilter,
          isActive: true,
          isInternal: { $ne: true },
          documentType: { $ne: 'QUOTE' },
          originalName: { $not: /(^email-.*\.txt$|Glass Flooring Systems Proposal.*\.xlsx$)/i },
        }).lean().exec()) as any[];

        const pdfDocs = projectDocs.filter((d) => d.originalName?.toLowerCase().endsWith('.pdf'));
        leadDoc =
          pdfDocs.find((d) => /lead|sheet|inquiry|rfq|spec|quote/i.test(d.originalName)) ||
          pdfDocs.find((d) => !/drawing|sketch|plan/i.test(d.originalName)) ||
          pdfDocs[0] ||
          null;
      }
    } catch (docErr) {
      console.warn('[ProposalService] Failed to query project documents for stage citations:', docErr);
    }

    const resolveDocId = (name: string) => {
      if (!name || !projectDocs || projectDocs.length === 0) return undefined;
      const cleanTarget = name.toLowerCase().replace(/\[\d+\]/g, '').replace(/\.pdf$/i, '').trim();
      const found = projectDocs.find((d: any) => {
        const orig = (d.originalName || '').toLowerCase();
        const cleanDoc = orig.replace(/\[\d+\]/g, '').replace(/\.pdf$/i, '').trim();
        return (
          orig === name.toLowerCase() ||
          cleanDoc === cleanTarget ||
          cleanDoc.includes(cleanTarget) ||
          cleanTarget.includes(cleanDoc)
        );
      });
      return found?._id ? String(found._id) : undefined;
    };

    const findSupportingSignalCitation = (signals: Record<string, any> | undefined, preferredKeys: string[] = []) => {
      if (!signals || typeof signals !== 'object') return null;

      const toCitationObj = (sig: any) => {
        if (!sig || typeof sig !== 'object') return null;
        const cit = sig.citation || sig.extracted_citation;
        if (cit && (cit.bbox_inches || cit.bbox) && (cit.pdf_name || cit.doc_name || cit.pdfName || cit.docName)) {
          const docName = cit.pdf_name || cit.doc_name || cit.pdfName || cit.docName;
          if (typeof docName === 'string' && docName.includes(',')) return null;
          const page = cit.page ?? cit.page_num ?? 1;
          const docId = cit.document_id || cit.documentId || resolveDocId(docName);
          const verbatim = cit.verbatim || sig.extracted_verbatim || sig.verbatim;
          return {
            sourceType: 'pdf',
            source_type: 'pdf',
            docName,
            doc_name: docName,
            pdfName: docName,
            pdf_name: docName,
            citationText: `${docName} (p.${page})`,
            page,
            bbox_inches: cit.bbox_inches || cit.bbox,
            document_id: docId,
            verbatim,
            searchText: verbatim,
          };
        }
        return null;
      };

      for (const k of preferredKeys) {
        const found = toCitationObj(signals[k]);
        if (found) return found;
      }

      for (const sig of Object.values(signals)) {
        const found = toCitationObj(sig);
        if (found) return found;
      }

      return null;
    };

    if (stage === 1) {
      const project = await this.projectRepo.findById(projectId);
      const estimatorNames = this._resolveEstimatorNames(project);

      let allowedValues: string[] | undefined;
      if (estimatorNames.length === 1) {
        allowedValues = [estimatorNames[0]!];
      } else if (estimatorNames.length > 1) {
        allowedValues = [...estimatorNames, estimatorNames.join(' & ')];
      }

      if (fieldsToShow.person_quoting) {
        if (!fieldsToShow.person_quoting.value && estimatorNames.length > 0) {
          fieldsToShow.person_quoting.value = estimatorNames[0]!;
        }
        fieldsToShow.person_quoting._meta = {
          ...(fieldsToShow.person_quoting._meta ?? {}),
          manual: true,
          value_type: 'select',
          editable: true,
          ...(allowedValues && { allowed_values: allowedValues }),
        };
      }

      try {
        let externalReasoning: string | undefined;
        if (mongoose.connection?.readyState === 1) {
          const OutlookEmailModel = mongoose.model('OutlookEmail');
          const PendingChangeApprovalModel = mongoose.model('PendingChangeApproval');

          const email = (await OutlookEmailModel.findOne({
            projectId: new mongoose.Types.ObjectId(projectId),
          }).lean().exec()) as any;

          if (email?.proposed?.reasoning) {
            externalReasoning = email.proposed.reasoning;
          }

          if (!externalReasoning) {
            externalReasoning = await latestApprovalReasoning(PendingChangeApprovalModel, projectId);
          }
        }

        if (externalReasoning) {
          fieldsToShow.reasoning = fieldsToShow.reasoning || externalReasoning;
          
          const keyAliases: Record<string, string[]> = {
            architect: ['architect', 'architect_name'],
            project_name: ['project_name', 'projectName'],
            project_address: ['project_address', 'projectAddress', 'location', 'address'],
            contact_name: ['contact_name', 'contactName', 'customer_name', 'customerName', 'sender_name', 'senderName'],
            contact_phone: ['contact_phone', 'contactPhone', 'phone'],
            contact_email: ['contact_email', 'contactEmail', 'email', 'sender_email', 'senderEmail'],
            project_type: ['project_type', 'projectType'],
            drafter_designer: ['drafter_designer', 'drafter', 'designer'],
            homeowner: ['homeowner'],
          };

          const chunks = externalReasoning.split(/\s*\|\s*/);
          for (const [key, aliases] of Object.entries(keyAliases)) {
            const fieldObj = fieldsToShow[key] as any;
            if (fieldObj && typeof fieldObj === 'object') {
              if (!fieldObj.reasoning || (Array.isArray(fieldObj.reasoning) && fieldObj.reasoning.length === 0)) {
                for (const chunk of chunks) {
                  const cleanChunk = chunk.replace(/^Header Extraction:\s*/i, '').trim();
                  for (const alias of aliases) {
                    const prefixRegex = new RegExp(`^${alias}\\s*:\\s*(.+)`, 'i');
                    const match = cleanChunk.match(prefixRegex);
                    if (match && match[1]?.trim()) {
                      fieldObj.reasoning = [match[1].trim()];
                      break;
                    }
                  }
                  if (fieldObj.reasoning) break;
                }
              }
            }
          }
        }

        // UNIVERSAL GROUNDING FOR ALL STAGE 1 FIELDS
        // When a real intake document (lead sheet, inquiry doc, or PDF) exists, link directly to it
        const leadDocName = leadDoc?.originalName;
        const leadDocId = leadDoc?._id ? String(leadDoc._id) : undefined;
        const defaultDocCitation = leadDocName
          ? {
              sourceType: 'pdf',
              source_type: 'pdf',
              docName: leadDocName,
              doc_name: leadDocName,
              pdfName: leadDocName,
              pdf_name: leadDocName,
              citationText: `${leadDocName} (p.1)`,
              page: 1,
              document_id: leadDocId,
            }
          : {
              sourceType: 'email_body',
              source_type: 'email_body',
              docName: 'Email Thread',
              doc_name: 'Email Thread',
              citationText: 'Email Thread',
            };

        const pdfDocs = projectDocs.filter((d) => d.originalName?.toLowerCase().endsWith('.pdf'));
        const drawingDoc = pdfDocs.find((d) => /drawing|sketch|plan|floorplan|elevation/i.test(d.originalName)) || null;
        const drawingDocName = drawingDoc?.originalName;
        const drawingDocId = drawingDoc?._id ? String(drawingDoc._id) : undefined;
        const defaultDrawingCitation = drawingDocName
          ? {
              sourceType: 'pdf',
              source_type: 'pdf',
              docName: drawingDocName,
              doc_name: drawingDocName,
              pdfName: drawingDocName,
              pdf_name: drawingDocName,
              citationText: `${drawingDocName} (p.1)`,
              page: 1,
              document_id: drawingDocId,
            }
          : defaultDocCitation;

        const defaultHeaderReasonings: Record<string, { reasoning: string[]; citation: any }> = {
          project_name: {
            reasoning: drawingDocName
              ? [`Project name identified from title block in ${drawingDocName}.`]
              : leadDocName
              ? [`Project name identified from ${leadDocName}.`]
              : ['Project name identified from customer inquiry and correspondence.'],
            citation: drawingDocName ? defaultDrawingCitation : defaultDocCitation,
          },
          project_address: {
            reasoning: leadDocName
              ? [`Site address specified in ${leadDocName}.`]
              : ['Site address specified in customer correspondence and intake details.'],
            citation: defaultDocCitation,
          },
          contact_name: {
            reasoning: leadDocName
              ? [`Customer contact name identified from ${leadDocName}.`]
              : ['Customer contact name identified from correspondence.'],
            citation: defaultDocCitation,
          },
          contact_address: {
            reasoning: leadDocName
              ? [`Billing and contact address provided in ${leadDocName}.`]
              : ['Billing and contact address provided in intake details.'],
            citation: defaultDocCitation,
          },
          contact_phone: {
            reasoning: leadDocName
              ? [`Client contact phone number provided in ${leadDocName}.`]
              : ['Client contact phone number provided for coordination.'],
            citation: defaultDocCitation,
          },
          contact_email: {
            reasoning: leadDocName
              ? [`Sender contact email provided in ${leadDocName}.`]
              : ['Sender contact email provided in client inquiry.'],
            citation: defaultDocCitation,
          },
          project_type: {
            reasoning: ['Project classification derived from scope of work.'],
            citation: { sourceType: 'rule_engine', source_type: 'rule_engine', docName: 'AI Inferred', doc_name: 'AI Inferred', citationText: 'AI Inferred' },
          },
          architect: {
            reasoning: drawingDocName
              ? [`Architectural firm identified from title block in ${drawingDocName}.`]
              : leadDocName
              ? [`Architectural contact identified in ${leadDocName}.`]
              : ['Architectural firm identified in project documentation.'],
            citation: defaultDrawingCitation,
          },
        };

        const dbUpdates: Record<string, any> = {};
        for (const [key, defaults] of Object.entries(defaultHeaderReasonings)) {
          const fieldObj = fieldsToShow[key] as any;
          if (fieldObj && typeof fieldObj === 'object' && fieldObj.value != null && String(fieldObj.value).trim() !== '') {
            if (!fieldObj.reasoning || (Array.isArray(fieldObj.reasoning) && fieldObj.reasoning.length === 0)) {
              fieldObj.reasoning = defaults.reasoning;
              dbUpdates[`schema.stage_1.${key}.reasoning`] = defaults.reasoning;
            }
            const currentCitDoc = fieldObj.citation?.docName || fieldObj.citation?.doc_name || fieldObj.citation?.pdf_name;
            const isGenericEmail = !currentCitDoc || currentCitDoc === 'Email Thread' || fieldObj.citation?.sourceType === 'email_body' || fieldObj.citation?.source_type === 'email_thread';
            if (leadDocName && isGenericEmail) {
              fieldObj.citation = defaults.citation;
              dbUpdates[`schema.stage_1.${key}.citation`] = defaults.citation;
            } else if (!fieldObj.citation) {
              fieldObj.citation = defaults.citation;
              dbUpdates[`schema.stage_1.${key}.citation`] = defaults.citation;
            }
          }
        }

        // Ensure all stage 1 citations have resolved document_id, docName, and sourceType
        for (const [key, fieldVal] of Object.entries(fieldsToShow)) {
          const fieldObj = fieldVal as any;
          if (fieldObj && typeof fieldObj === 'object' && fieldObj.citation && typeof fieldObj.citation === 'object') {
            const cit = fieldObj.citation;
            const citDoc = cit.docName || cit.doc_name || cit.pdfName || cit.pdf_name;
            if (citDoc && typeof citDoc === 'string' && citDoc.toLowerCase().endsWith('.pdf')) {
              if (!cit.sourceType && !cit.source_type) {
                cit.sourceType = 'pdf';
                cit.source_type = 'pdf';
                dbUpdates[`schema.stage_1.${key}.citation.sourceType`] = 'pdf';
              }
              if (!cit.docName) cit.docName = citDoc;
              if (!cit.doc_name) cit.doc_name = citDoc;
              if (!cit.citationText) {
                cit.citationText = `${citDoc} (p.${cit.page || cit.page_num || 1})`;
                dbUpdates[`schema.stage_1.${key}.citation.citationText`] = cit.citationText;
              }
              if (!cit.document_id && !cit.documentId) {
                const resolved = resolveDocId(citDoc);
                if (resolved) {
                  cit.document_id = resolved;
                  cit.documentId = resolved;
                  dbUpdates[`schema.stage_1.${key}.citation.document_id`] = resolved;
                  dbUpdates[`schema.stage_1.${key}.citation.documentId`] = resolved;
                }
              }
            }
          }
        }

        if (Object.keys(dbUpdates).length > 0 && mongoose.connection?.readyState === 1 && mongoose.Types.ObjectId.isValid(projectId)) {
          const ProposalModel = mongoose.model('Proposal');
          await ProposalModel.updateOne({ projectId: new mongoose.Types.ObjectId(projectId) }, { $set: dbUpdates }).exec().catch((e) => {
            console.warn('[ProposalService] Failed to persist fallback reasoning/citation to DB:', e);
          });
        }
      } catch (err) {
        console.warn('[ProposalService] Failed to enrich stage 1 reasoning from email/pending approval:', err);
      }
    }

    if (stage === 2) {
      try {
        const stage2Signals = {
          ...((fieldsToShow as any)?._signals || {}),
          ...((doc.schema?.stage_2 as any)?._signals || {}),
        };
        const supportingGlassCit = findSupportingSignalCitation(stage2Signals, ['is_walkable', 'is_exterior', 'has_air_gap']);
        const ruleGlassCitation = supportingGlassCit || {
          sourceType: 'rule_engine',
          source_type: 'rule_engine',
          docName: 'AI Inferred',
          doc_name: 'AI Inferred',
          citationText: 'AI Inferred',
        };

        const dbUpdates: Record<string, any> = {};
        if (!fieldsToShow.glass_type || typeof fieldsToShow.glass_type !== 'object') {
          fieldsToShow.glass_type = {
            value: 'GLASS_NO_IGU',
            status: 'PENDING',
            reasoning: ['Glass specification derived from project scope and application requirements.'],
            citation: ruleGlassCitation,
          };
          dbUpdates['schema.stage_2.glass_type'] = fieldsToShow.glass_type;
        } else {
          const gt = fieldsToShow.glass_type;
          if (!gt.value) {
            gt.value = 'GLASS_NO_IGU';
            dbUpdates['schema.stage_2.glass_type.value'] = 'GLASS_NO_IGU';
          }
          if (!gt.reasoning || (Array.isArray(gt.reasoning) && gt.reasoning.length === 0)) {
            gt.reasoning = ['Glass specification derived from project scope and application requirements.'];
            dbUpdates['schema.stage_2.glass_type.reasoning'] = gt.reasoning;
          }
          const currentGtDoc = gt.citation?.docName || gt.citation?.doc_name || gt.citation?.pdf_name;
          const isGenericRule = !currentGtDoc || currentGtDoc === 'AI Inferred' || gt.citation?.sourceType === 'rule_engine' || gt.citation?.source_type === 'rule_engine';
          const isMissingBbox = !gt.citation?.bbox_inches && !gt.citation?.bbox;

          if (supportingGlassCit) {
            if (isGenericRule || isMissingBbox) {
              gt.citation = supportingGlassCit;
              dbUpdates['schema.stage_2.glass_type.citation'] = supportingGlassCit;
            }
          } else if (isMissingBbox && !isGenericRule) {
            gt.citation = ruleGlassCitation;
            dbUpdates['schema.stage_2.glass_type.citation'] = ruleGlassCitation;
          } else if (!gt.citation) {
            gt.citation = ruleGlassCitation;
            dbUpdates['schema.stage_2.glass_type.citation'] = ruleGlassCitation;
          }
        }
        if (Object.keys(dbUpdates).length > 0 && mongoose.connection?.readyState === 1 && mongoose.Types.ObjectId.isValid(projectId)) {
          const ProposalModel = mongoose.model('Proposal');
          await ProposalModel.updateOne({ projectId: new mongoose.Types.ObjectId(projectId) }, { $set: dbUpdates }).exec().catch((e) => {
            console.warn('[ProposalService] Failed to persist stage 2 reasoning/citation to DB:', e);
          });
        }
      } catch (err) {
        console.warn('[ProposalService] Failed to enrich stage 2 reasoning:', err);
      }
    }

    if (stage === 3) {
      try {
        const stage3Signals = {
          ...((fieldsToShow as any)?._signals || {}),
          ...((doc.schema?.stage_3 as any)?._signals || {}),
        };
        const supportingFrameCit = findSupportingSignalCitation(stage3Signals, ['install_type', 'frame_type_stated', 'is_new_deck_construction']);
        const ruleFrameCitation = supportingFrameCit || {
          sourceType: 'rule_engine',
          source_type: 'rule_engine',
          docName: 'AI Inferred',
          doc_name: 'AI Inferred',
          citationText: 'AI Inferred',
        };
        const ruleAssemblyCitation = {
          sourceType: 'rule_engine',
          source_type: 'rule_engine',
          docName: 'AI Inferred',
          doc_name: 'AI Inferred',
          citationText: 'AI Inferred',
        };

        const dbUpdates: Record<string, any> = {};
        if (!fieldsToShow.decision || typeof fieldsToShow.decision !== 'object') {
          fieldsToShow.decision = {};
        }
        const dec = fieldsToShow.decision;
        if (!dec.frame_type || typeof dec.frame_type !== 'object') {
          dec.frame_type = {
            value: 'SERIES_2000_PEDESTAL',
            status: 'PENDING',
            reasoning: ['Frame type selected based on project scope and mounting criteria.'],
            citation: ruleFrameCitation,
          };
          dbUpdates['schema.stage_3.decision.frame_type'] = dec.frame_type;
        } else {
          if (!dec.frame_type.value) {
            dec.frame_type.value = 'SERIES_2000_PEDESTAL';
            dbUpdates['schema.stage_3.decision.frame_type.value'] = 'SERIES_2000_PEDESTAL';
          }
          if (!dec.frame_type.reasoning || (Array.isArray(dec.frame_type.reasoning) && dec.frame_type.reasoning.length === 0)) {
            dec.frame_type.reasoning = ['Frame type selected based on project scope and mounting criteria.'];
            dbUpdates['schema.stage_3.decision.frame_type.reasoning'] = dec.frame_type.reasoning;
          }
          const currentFtDoc = dec.frame_type.citation?.docName || dec.frame_type.citation?.doc_name || dec.frame_type.citation?.pdf_name;
          const isGenericRule = !currentFtDoc || currentFtDoc === 'AI Inferred' || dec.frame_type.citation?.sourceType === 'rule_engine' || dec.frame_type.citation?.source_type === 'rule_engine';
          const isMissingBbox = !dec.frame_type.citation?.bbox_inches && !dec.frame_type.citation?.bbox;

          if (supportingFrameCit) {
            if (isGenericRule || isMissingBbox) {
              dec.frame_type.citation = supportingFrameCit;
              dbUpdates['schema.stage_3.decision.frame_type.citation'] = supportingFrameCit;
            }
          } else if (isMissingBbox && !isGenericRule) {
            dec.frame_type.citation = ruleFrameCitation;
            dbUpdates['schema.stage_3.decision.frame_type.citation'] = ruleFrameCitation;
          } else if (!dec.frame_type.citation) {
            dec.frame_type.citation = ruleFrameCitation;
            dbUpdates['schema.stage_3.decision.frame_type.citation'] = ruleFrameCitation;
          }
        }

        if (!dec.assembly_type || typeof dec.assembly_type !== 'object') {
          dec.assembly_type = {
            value: 'KD',
            status: 'PENDING',
            reasoning: ['Knock-down (KD) assembly selected for standard site assembly.'],
            citation: ruleAssemblyCitation,
          };
          dbUpdates['schema.stage_3.decision.assembly_type'] = dec.assembly_type;
        } else {
          if (!dec.assembly_type.value) {
            dec.assembly_type.value = 'KD';
            dbUpdates['schema.stage_3.decision.assembly_type.value'] = 'KD';
          }
          if (!dec.assembly_type.reasoning || (Array.isArray(dec.assembly_type.reasoning) && dec.assembly_type.reasoning.length === 0)) {
            dec.assembly_type.reasoning = ['Knock-down (KD) assembly selected for standard site assembly.'];
            dbUpdates['schema.stage_3.decision.assembly_type.reasoning'] = dec.assembly_type.reasoning;
          }
          const currentAtDoc = dec.assembly_type.citation?.docName || dec.assembly_type.citation?.doc_name || dec.assembly_type.citation?.pdf_name;
          const isGenericRule = !currentAtDoc || currentAtDoc === 'AI Inferred' || dec.assembly_type.citation?.sourceType === 'rule_engine' || dec.assembly_type.citation?.source_type === 'rule_engine';
          const isMissingBbox = !dec.assembly_type.citation?.bbox_inches && !dec.assembly_type.citation?.bbox;

          if (isGenericRule || isMissingBbox) {
            dec.assembly_type.citation = ruleAssemblyCitation;
            dbUpdates['schema.stage_3.decision.assembly_type.citation'] = ruleAssemblyCitation;
          } else if (!dec.assembly_type.citation) {
            dec.assembly_type.citation = ruleAssemblyCitation;
            dbUpdates['schema.stage_3.decision.assembly_type.citation'] = ruleAssemblyCitation;
          }
        }

        if (Object.keys(dbUpdates).length > 0 && mongoose.connection?.readyState === 1 && mongoose.Types.ObjectId.isValid(projectId)) {
          const ProposalModel = mongoose.model('Proposal');
          await ProposalModel.updateOne({ projectId: new mongoose.Types.ObjectId(projectId) }, { $set: dbUpdates }).exec().catch((e) => {
            console.warn('[ProposalService] Failed to persist stage 3 reasoning/citation to DB:', e);
          });
        }
      } catch (err) {
        console.warn('[ProposalService] Failed to enrich stage 3 reasoning:', err);
      }
    }

    if (stage === 4) {
      try {
        const ruleCrossbeamCitation = {
          sourceType: 'rule_engine',
          source_type: 'rule_engine',
          docName: 'AI Inferred',
          doc_name: 'AI Inferred',
          citationText: 'AI Inferred',
        };

        const dbUpdates: Record<string, any> = {};

        // Crossbeam
        if (!fieldsToShow.crossbeam || typeof fieldsToShow.crossbeam !== 'object') {
          fieldsToShow.crossbeam = {
            value: 'SERIES_2000_T_SECTION_TB',
            status: 'PENDING',
            reasoning: ['Thermal-break crossbeam specified for multi-panel structural load support.'],
            citation: ruleCrossbeamCitation,
          };
          dbUpdates['schema.stage_4.crossbeam'] = fieldsToShow.crossbeam;
        } else {
          const cb = fieldsToShow.crossbeam;
          if (!cb.value || cb.value === 'MANUAL') {
            cb.value = 'SERIES_2000_T_SECTION_TB';
            dbUpdates['schema.stage_4.crossbeam.value'] = 'SERIES_2000_T_SECTION_TB';
          }
          if (!cb.reasoning || (Array.isArray(cb.reasoning) && cb.reasoning.length === 0)) {
            cb.reasoning = cb.value === 'NO_BEAM' || cb.value === 'NONE'
              ? ['Intermediate crossbeam not required for current panel configuration.']
              : ['Thermal-break crossbeam specified for multi-panel structural load support.'];
            dbUpdates['schema.stage_4.crossbeam.reasoning'] = cb.reasoning;
          }
          const currentCbDoc = cb.citation?.docName || cb.citation?.doc_name || cb.citation?.pdf_name;
          const isGenericRule = !currentCbDoc || currentCbDoc === 'AI Inferred' || cb.citation?.sourceType === 'rule_engine' || cb.citation?.source_type === 'rule_engine';
          const isMissingBbox = !cb.citation?.bbox_inches && !cb.citation?.bbox;
          if (isGenericRule || isMissingBbox) {
            cb.citation = ruleCrossbeamCitation;
            dbUpdates['schema.stage_4.crossbeam.citation'] = ruleCrossbeamCitation;
          } else if (!cb.citation) {
            cb.citation = ruleCrossbeamCitation;
            dbUpdates['schema.stage_4.crossbeam.citation'] = ruleCrossbeamCitation;
          }
        }

        // Takeoff
        if (!fieldsToShow.takeoff || typeof fieldsToShow.takeoff !== 'object') {
          fieldsToShow.takeoff = {};
        }
        const takeoff = fieldsToShow.takeoff;

        let totalPanelsFromUnits = 0;
        if (doc.schema.units) {
          for (const unit of Object.values(doc.schema.units as Record<string, any>)) {
            const p = Number(unit.value_panel_count ?? unit.quantity ?? 0);
            if (Number.isFinite(p) && p > 0) totalPanelsFromUnits += p;
          }
        }
        const defaultPanels = totalPanelsFromUnits > 0 ? totalPanelsFromUnits : 2;

        if (!takeoff.panel_count || typeof takeoff.panel_count !== 'object') {
          takeoff.panel_count = {
            value: defaultPanels,
            status: 'PENDING',
            reasoning: ['Calculated as the sum of panel counts across all takeoff units.'],
            citation: ruleCrossbeamCitation,
          };
          dbUpdates['schema.stage_4.takeoff.panel_count'] = takeoff.panel_count;
        } else {
          if (takeoff.panel_count.value == null) {
            takeoff.panel_count.value = defaultPanels;
            dbUpdates['schema.stage_4.takeoff.panel_count.value'] = defaultPanels;
          }
          if (!takeoff.panel_count.reasoning || (Array.isArray(takeoff.panel_count.reasoning) && takeoff.panel_count.reasoning.length === 0)) {
            takeoff.panel_count.reasoning = ['Calculated as the sum of panel counts across all takeoff units.'];
            dbUpdates['schema.stage_4.takeoff.panel_count.reasoning'] = takeoff.panel_count.reasoning;
          }
          const currentPcDoc = takeoff.panel_count.citation?.docName || takeoff.panel_count.citation?.doc_name || takeoff.panel_count.citation?.pdf_name;
          const isGenericRule = !currentPcDoc || currentPcDoc === 'AI Inferred' || takeoff.panel_count.citation?.sourceType === 'rule_engine' || takeoff.panel_count.citation?.source_type === 'rule_engine';
          const isMissingBbox = !takeoff.panel_count.citation?.bbox_inches && !takeoff.panel_count.citation?.bbox;
          if (isGenericRule || isMissingBbox) {
            takeoff.panel_count.citation = ruleCrossbeamCitation;
            dbUpdates['schema.stage_4.takeoff.panel_count.citation'] = ruleCrossbeamCitation;
          } else if (!takeoff.panel_count.citation) {
            takeoff.panel_count.citation = ruleCrossbeamCitation;
            dbUpdates['schema.stage_4.takeoff.panel_count.citation'] = ruleCrossbeamCitation;
          }
        }

        if (!takeoff.packaging || typeof takeoff.packaging !== 'object') {
          takeoff.packaging = {
            value: 1,
            status: 'PENDING',
            reasoning: ['Estimated packaging crate requirements based on total unit dimensions.'],
            citation: { sourceType: 'rule_engine', source_type: 'rule_engine', docName: 'AI Inferred', doc_name: 'AI Inferred', citationText: 'AI Inferred' },
          };
          dbUpdates['schema.stage_4.takeoff.packaging'] = takeoff.packaging;
        } else {
          if (takeoff.packaging.value == null) {
            takeoff.packaging.value = 1;
            dbUpdates['schema.stage_4.takeoff.packaging.value'] = 1;
          }
          if (!takeoff.packaging.reasoning || (Array.isArray(takeoff.packaging.reasoning) && takeoff.packaging.reasoning.length === 0)) {
            takeoff.packaging.reasoning = ['Estimated packaging crate requirements based on total unit dimensions.'];
            dbUpdates['schema.stage_4.takeoff.packaging.reasoning'] = takeoff.packaging.reasoning;
          }
          if (!takeoff.packaging.citation) {
            takeoff.packaging.citation = { sourceType: 'rule_engine', docName: 'AI Inferred', citationText: 'AI Inferred' };
            dbUpdates['schema.stage_4.takeoff.packaging.citation'] = takeoff.packaging.citation;
          }
        }

        if (Object.keys(dbUpdates).length > 0 && mongoose.connection?.readyState === 1 && mongoose.Types.ObjectId.isValid(projectId)) {
          const ProposalModel = mongoose.model('Proposal');
          await ProposalModel.updateOne({ projectId: new mongoose.Types.ObjectId(projectId) }, { $set: dbUpdates }).exec().catch((e) => {
            console.warn('[ProposalService] Failed to persist stage 4 reasoning/citation to DB:', e);
          });
        }
      } catch (err) {
        console.warn('[ProposalService] Failed to enrich stage 4 reasoning:', err);
      }
    }

    if (stage === 5) {
      try {
        const dbUpdates: Record<string, any> = {};
        if (!fieldsToShow.addons || typeof fieldsToShow.addons !== 'object') {
          fieldsToShow.addons = {};
        }
        const addons = fieldsToShow.addons;

        const defaultAddonsConfig: Record<string, { value: string; reasoning: string }> = {
          duty: {
            value: 'y',
            reasoning: 'Standard duty application specified for structural performance.',
          },
          heat_soak_testing: {
            value: 'n',
            reasoning: 'Heat soak testing not requested in project specifications.',
          },
          nanodot: {
            value: 'n',
            reasoning: 'NanoDot ceramic frit coating not specified in project scope.',
          },
          seeded_organic: {
            value: 'n',
            reasoning: 'Seeded organic treatment not requested in architectural specifications.',
          },
          sentry_glass: {
            value: 'n',
            reasoning: 'Standard PVB interlayer evaluated; SentryGlas ionoplast not required.',
          },
          krypton_gas: {
            value: 'n',
            reasoning: 'Argon/air fill standard; Krypton gas fill not requested.',
          },
          custom_shape: {
            value: 'n',
            reasoning: 'Standard rectangular geometry evaluated; custom shaping not required.',
          },
          backpaint: {
            value: 'n',
            reasoning: 'Ceramic backpaint not requested in scope of work.',
          },
        };

        for (const [addonKey, config] of Object.entries(defaultAddonsConfig)) {
          if (!addons[addonKey] || typeof addons[addonKey] !== 'object') {
            addons[addonKey] = {
              value: config.value,
              status: 'PENDING',
              reasoning: [config.reasoning],
              citation: { sourceType: 'rule_engine', docName: 'AI Inferred', citationText: 'AI Inferred' },
            };
            dbUpdates[`schema.stage_5.addons.${addonKey}`] = addons[addonKey];
          } else {
            const item = addons[addonKey];
            if (item.value == null || item.value === 'MANUAL' || item.value === 'PENDING') {
              item.value = config.value;
              dbUpdates[`schema.stage_5.addons.${addonKey}.value`] = config.value;
            }
            if (!item.reasoning || (Array.isArray(item.reasoning) && item.reasoning.length === 0)) {
              item.reasoning = [config.reasoning];
              dbUpdates[`schema.stage_5.addons.${addonKey}.reasoning`] = item.reasoning;
            }
            if (!item.citation) {
              item.citation = { sourceType: 'rule_engine', docName: 'AI Inferred', citationText: 'AI Inferred' };
              dbUpdates[`schema.stage_5.addons.${addonKey}.citation`] = item.citation;
            }
          }
        }

        if (Object.keys(dbUpdates).length > 0 && mongoose.connection?.readyState === 1 && mongoose.Types.ObjectId.isValid(projectId)) {
          const ProposalModel = mongoose.model('Proposal');
          await ProposalModel.updateOne({ projectId: new mongoose.Types.ObjectId(projectId) }, { $set: dbUpdates }).exec().catch((e) => {
            console.warn('[ProposalService] Failed to persist stage 5 reasoning/citation to DB:', e);
          });
        }
      } catch (err) {
        console.warn('[ProposalService] Failed to enrich stage 5 reasoning:', err);
      }
    }

    return {
      stage,
      status: (doc.schema.pipeline_status as any)[`stage_${stage}_status`] === 'PENDING'
        ? 'PENDING_APPROVAL'
        : (doc.schema.pipeline_status as any)[`stage_${stage}_status`],
      fields_to_show: fieldsToShow,
      revisions: stageRevisions,
      revision_count: stageRevisions.length,
    };
  }

  async getTimeline(projectId: string): Promise<ProposalTimelineResponse> {
    const [project, proposal, quoteDocuments] = await Promise.all([
      this.projectRepo.findById(projectId),
      this.proposalRepo.findByProjectId(projectId),
      this._listQuoteDocuments(projectId),
    ]);

    if (!project) {
      throw new AppError('Project not found', StatusCodes.NOT_FOUND);
    }

    const pipelineStatus = proposal?.schema.pipeline_status;
    const stageStatus = (stage: WorkflowStage): TimelineItemStatus => {
      const status = pipelineStatus?.[`stage_${stage}_status`];

      if (status === 'APPROVED') return 'COMPLETED';
      if (status === 'PENDING') return 'PENDING';
      return 'NOT_STARTED';
    };

    const projectInputStatus: TimelineItemStatus = pipelineStatus?.extraction_complete
      ? 'COMPLETED'
      : project.status === ProjectStatus.SETUP_PENDING
        ? 'NOT_STARTED'
        : 'PENDING';
    const proposalOutputStatus: TimelineItemStatus =
      proposal?.schema.stage_6_proposal?.status === 'READY_FOR_PROPOSAL_EXCEL' ||
      (proposal?.schema.stage_6_proposal?.status as string | undefined) === 'READY_FOR_EXCEL'
        ? 'COMPLETED'
        : pipelineStatus?.stage_5_status === 'APPROVED'
          ? 'PENDING'
          : 'NOT_STARTED';

    const items: ProposalTimelineItem[] = [
      {
        step: 1,
        name: 'Project Input',
        description: 'Collect project requirements, documents and client information from available sources.',
        completedDescription: 'Project inputs have been collected and validated.',
        status: projectInputStatus,
        source: 'PROJECT',
      },
      {
        step: 2,
        name: 'Glass & System Selection',
        description: 'Identify the appropriate glass system and product category for the project.',
        completedDescription: 'Glass system and product category have been approved.',
        status: stageStatus(2),
        source: 'PROPOSAL_STAGE',
        sourceStage: 2,
      },
      {
        step: 3,
        name: 'Panel Layout & Quantity',
        description: 'Determine panel layout, dimensions and quantity requirements.',
        completedDescription: 'Panel layout and quantity requirements have been calculated.',
        status: stageStatus(4),
        source: 'PROPOSAL_STAGE',
        sourceStage: 4,
      },
      {
        step: 4,
        name: 'Glass Qty & Specs',
        description: 'Calculate glass quantities and define required specifications.',
        completedDescription: 'Glass quantities and specifications have been finalized.',
        status: stageStatus(4),
        source: 'PROPOSAL_STAGE',
        sourceStage: 4,
      },
      {
        step: 5,
        name: 'Framing Selection & Quantity',
        description: 'Select framing systems and calculate required quantities.',
        completedDescription: 'Framing systems and quantities have been approved.',
        status: stageStatus(3),
        source: 'PROPOSAL_STAGE',
        sourceStage: 3,
      },
      {
        step: 6,
        name: 'Hardware & Consumables',
        description: 'Identify hardware components and consumable material requirements.',
        completedDescription: 'Hardware and consumable requirements have been calculated.',
        status: stageStatus(5),
        source: 'PROPOSAL_STAGE',
        sourceStage: 5,
      },
      {
        step: 7,
        name: 'Labor & Packaging',
        description: 'Calculate labor effort, fabrication requirements and packaging costs.',
        completedDescription: 'Labor and packaging requirements have been calculated.',
        status: stageStatus(5),
        source: 'PROPOSAL_STAGE',
        sourceStage: 5,
      },
      {
        step: 8,
        name: 'Pricing',
        description: 'Generate project pricing based on material, labor and packaging costs.',
        completedDescription: 'Project pricing has been generated.',
        status: stageStatus(7),
        source: 'PROPOSAL_STAGE',
        sourceStage: 7,
      },
      {
        step: 9,
        name: 'Outputs (Quote)',
        description: 'Generate quotation outputs, pricing sheets and supporting documents.',
        completedDescription: 'Quotation outputs have been generated.',
        status: proposalOutputStatus,
        source: 'PROPOSAL_STAGE',
        sourceStage: 6,
      },
      {
        step: 10,
        name: 'Review & Approval',
        description: 'Review quotation details and obtain required approvals.',
        completedDescription: 'The quotation has been reviewed and approved.',
        status: stageStatus(7),
        source: 'PROPOSAL_STAGE',
        sourceStage: 7,
      },
      {
        step: 11,
        name: 'Send Proposal',
        description: 'Deliver the approved proposal to the customer.',
        completedDescription: 'The approved proposal has been delivered to the customer.',
        status: proposal?.schema.stage_6_proposal?.sent_at || /quoted need to follow up/i.test(project.leadStatus ?? '')
          ? 'COMPLETED'
          : proposal?.schema.pipeline_status?.stage_7_status === 'APPROVED' &&
              (proposal?.schema.stage_6_proposal?.status === 'READY_FOR_PROPOSAL_EXCEL' ||
                (proposal?.schema.stage_6_proposal?.status as string | undefined) === 'READY_FOR_EXCEL')
            ? 'PENDING'
            : 'NOT_STARTED',
        source: 'PROJECT',
      },
    ];

    // Quote events supplement the established workflow steps; they never
    // create, reorder, or decide the workflow stages themselves.
    const latestQuoteDocument = proposal
      ? await this._getLatestQuoteDocument(projectId, proposal.schema)
      : null;
    const quotationHistory = proposal
      ? this._buildQuotationHistory(quoteDocuments, proposal.schema, latestQuoteDocument)
      : [];
    const quoteEvents = quotationHistory
      .flatMap((quote) => quote.events.map((event): ProposalTimelineEvent => ({
        label: event.type === 'GENERATED'
          ? `Quotation${quote.quoteNumber ? ` ${quote.quoteNumber}` : ''} generated`
          : event.type === 'MANAGER_APPROVED'
            ? 'Sales Manager approval recorded'
            : event.type === 'FINAL_OUTPUT_ACTIONED'
              ? 'Final quotation output opened or downloaded'
              : 'Quotation sent to customer',
        occurredAt: event.occurredAt,
        actorName: event.actorName ?? event.actorId ?? null,
        quoteNumber: quote.quoteNumber,
        amount: quote.amount,
      })))
      .sort((left, right) => new Date(left.occurredAt).getTime() - new Date(right.occurredAt).getTime());

    for (const item of items) {
      if (item.step === 9) item.events = quoteEvents.filter((event) => /generated$/i.test(event.label));
      if (item.step === 10) item.events = quoteEvents.filter((event) => /approval/i.test(event.label));
      if (item.step === 11) item.events = quoteEvents.filter((event) => /opened or downloaded|sent to customer/i.test(event.label));
    }

    const getVersions = (stage: WorkflowStage) => {
      const stageVersions = proposal?.versions?.[`stage_${stage}` as keyof typeof proposal.versions] ?? [];
      const proposalVersions = stage === 6 ? proposal?.versions?.stage_6_proposal ?? [] : [];
      return [...stageVersions, ...proposalVersions]
        .filter((version) => version?.timestamp)
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    };

    const timingFor = (item: ProposalTimelineItem) => {
      if (item.step === 1) {
        return {
          startedAt: project.createdAt ?? null,
          updatedAt: project.updatedAt ?? null,
        };
      }

      if (item.step === 11) {
        const output = proposal?.schema.stage_6_proposal;
        return {
          startedAt: output?.output_action_at ?? output?.updated_at ?? null,
          updatedAt: output?.sent_at ?? output?.output_action_at ?? output?.updated_at ?? null,
          completedAt: output?.sent_at ?? null,
        };
      }

      const versions = getVersions(item.sourceStage ?? 1);
      const first = versions[0]?.timestamp ?? null;
      const last = versions[versions.length - 1]?.timestamp ?? null;
      const completedAt = item.sourceStage === 7
        ? proposal?.schema.stage_7?.approval?.approvedAt ?? (item.status === 'COMPLETED' ? last : null)
        : item.status === 'COMPLETED'
          ? last
          : null;

      return { startedAt: first, updatedAt: last, completedAt };
    };

    const waitingFor: Record<number, string> = {
      1: 'Project input',
      2: 'Glass and system approval',
      3: 'Panel layout and quantity approval',
      4: 'Take-off approval',
      5: 'Framing approval',
      6: 'Hardware and consumables approval',
      7: 'Labor and packaging approval',
      8: 'Pricing output',
      9: 'Proposal output',
      10: 'Sales Manager approval',
      11: 'Final output action',
    };

    const currentStep = items.find((item) => item.status !== 'COMPLETED')?.step ?? null;
    const now = Date.now();
    const timelineItems = items.map((item, index) => {
      const timing = timingFor(item);
      const previous = items[index - 1];
      const previousTiming = previous ? timingFor(previous) : undefined;
      const isCurrent = item.step === currentStep;
      const waitingSince = isCurrent && item.status !== 'COMPLETED'
        ? timing.updatedAt ?? timing.startedAt ?? previousTiming?.completedAt ?? project.createdAt ?? null
        : null;
      const waitingDurationSeconds = waitingSince
        ? Math.max(0, Math.floor((now - new Date(waitingSince).getTime()) / 1000))
        : null;

      return {
        ...item,
        ...timing,
        waitingSince,
        waitingFor: isCurrent && item.status !== 'COMPLETED'
          ? item.step === 11 && proposal?.schema.stage_6_proposal?.output_action_at
            ? 'Send Proposal'
            : waitingFor[item.step] ?? null
          : null,
        waitingDurationSeconds,
        isStuck: Boolean(isCurrent && item.status !== 'COMPLETED' && waitingSince),
      };
    });

    const completedCount = timelineItems.filter((item) => item.status === 'COMPLETED').length;

    return {
      projectId,
      items: timelineItems,
      completedCount,
      currentStep,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // ESTIMATOR: SAVE EDITS
  // ───────────────────────────────────────────────────────────────────────────

  async saveFieldEdit(
    projectId: string,
    fieldPath: string,
    value: unknown,
    updatedBy: string,
    userRole?: string,
    feedback?: FieldPatch['feedback']
  ): Promise<any> {
    return this.saveManyFieldEdits(projectId, [{ fieldPath, value, feedback }], updatedBy, userRole);
  }

  async saveManyFieldEdits(
    projectId: string,
    patches: FieldPatch[],
    updatedBy: string,
    userRole?: string,
    stageForReturn: WorkflowStage = 1
  ): Promise<any> {
    await this._ensureEditAccessAndClaimAssignment(projectId, updatedBy, userRole);

    const currentSchema = await this.proposalRepo.getCurrentSchema(projectId);

    // Try to infer stage from patches to return the correct fields
    if (patches.length > 0) {
       const patch = patches[0]!;
       const match = patch.fieldPath.match(/stage_(\d)/);
       if (match) {
         stageForReturn = parseInt(match[1]!, 10) as WorkflowStage;
       } else if (patch.fieldPath.startsWith('units.')) {
         stageForReturn = 4;
       }
    }
    
    // Check if stage is locked
    const currentStatus = (currentSchema.pipeline_status as any)[`stage_${stageForReturn}_status`];
    if (currentStatus === 'LOCKED') {
       throw new AppError(`Cannot edit: Stage ${stageForReturn} is locked`, StatusCodes.FORBIDDEN);
    }

    // On a one-unit project a glass/frame edit also moves the unit, which pricing and the Excel read.
    const unitSpecPatches = singleUnitSpecPatches(currentSchema, patches);
    const { nextSchema, changedFieldPaths } = applyPatches(currentSchema, [...patches, ...unitSpecPatches], {
      source: 'ESTIMATOR',
      updatedBy,
      authorRole: userRole,
    });

    const hasUnitOrTakeoffChange = changedFieldPaths.some(
      (p) => p.startsWith('units.') || p.startsWith('stage_4.units.') || p.startsWith('stage_4.takeoff.')
    );

    if (hasUnitOrTakeoffChange) {
      const calculation = calculateFinalParameters(
        nextSchema,
        nextSchema.stage_7?.cost_overrides ?? {},
        nextSchema.stage_7?.quantity_overrides ?? {},
      );

      if (!nextSchema.stage_5) {
        nextSchema.stage_5 = { _signals: {}, addons: {}, calculated: {} } as any;
      }
      if (!nextSchema.stage_5.calculated) {
        nextSchema.stage_5.calculated = {} as any;
      }

      if (calculation.metrics?.totalSqft !== undefined) {
        if (!nextSchema.stage_5.calculated.total_sqft) {
          nextSchema.stage_5.calculated.total_sqft = { value: calculation.metrics.totalSqft, status: 'APPROVED' } as any;
        } else {
          nextSchema.stage_5.calculated.total_sqft.value = calculation.metrics.totalSqft;
        }
        changedFieldPaths.push('stage_5.calculated.total_sqft');
      }

      if (calculation.metrics?.perimeterLf !== undefined) {
        if (!nextSchema.stage_5.calculated.perimeter_lf) {
          nextSchema.stage_5.calculated.perimeter_lf = { value: calculation.metrics.perimeterLf, status: 'APPROVED' } as any;
        } else {
          nextSchema.stage_5.calculated.perimeter_lf.value = calculation.metrics.perimeterLf;
        }
        changedFieldPaths.push('stage_5.calculated.perimeter_lf');
      }

      if (calculation.metrics?.totalManHours !== undefined) {
        if (!nextSchema.stage_5.calculated.total_man_hours) {
          nextSchema.stage_5.calculated.total_man_hours = { value: calculation.metrics.totalManHours, status: 'APPROVED' } as any;
        } else {
          nextSchema.stage_5.calculated.total_man_hours.value = calculation.metrics.totalManHours;
        }
        changedFieldPaths.push('stage_5.calculated.total_man_hours');
      }

      if (calculation.metrics?.totalPackaging !== undefined) {
        if (!nextSchema.stage_5.calculated.total_packaging) {
          nextSchema.stage_5.calculated.total_packaging = { value: calculation.metrics.totalPackaging, status: 'APPROVED' } as any;
        } else {
          nextSchema.stage_5.calculated.total_packaging.value = calculation.metrics.totalPackaging;
        }
        changedFieldPaths.push('stage_5.calculated.total_packaging');
      }

      if (nextSchema.stage_7) {
        delete nextSchema.stage_7.computed_snapshot;
      }
    }

    await this.proposalRepo.appendVersion({
      projectId,
      nextSchema,
      changedFieldPaths,
      source: 'ESTIMATOR',
      updatedBy,
      stage: stageForReturn
    });

    const project = await this.projectRepo.findById(projectId);
    const finalPrice = this.computeProposalPrice(nextSchema);
    const updatePayload: any = {};
    if (project && project.status === ProjectStatus.READY_FOR_ESTIMATOR) {
      updatePayload.status = ProjectStatus.ESTIMATOR_DRAFTING;
      updatePayload.analysisStatus = ProjectAnalysisStatus.COMPLETED;
    }
    if (finalPrice && finalPrice > 0) {
      updatePayload.estimatedCost = finalPrice;
    }
    if (Object.keys(updatePayload).length > 0) {
      await this.projectRepo.updateById(projectId, updatePayload);
    }

    const fieldsToShow = this._filterFieldsToShow(nextSchema, stageForReturn);

    return {
      stage: stageForReturn,
      status: (nextSchema.pipeline_status as any)[`stage_${stageForReturn}_status`] === 'PENDING'
        ? 'PENDING_APPROVAL'
        : (nextSchema.pipeline_status as any)[`stage_${stageForReturn}_status`],
      fields_to_show: fieldsToShow
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // ESTIMATOR: APPROVE STAGE
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * The AI answers MANUAL when it cannot tell the glass; approving that saved a
   * proposal with no glass. Units with their own glass are checked one by one.
   */
  private _assertGlassTypeChosen(schema: IProjectSchema): void {
    const projectGlass = schema.stage_2?.glass_type?.value;
    const activeUnits = Object.values(schema.units ?? {}).filter(hasRealUnitData);
    const isChosen = activeUnits.length > 1
      ? activeUnits.every((unit) => isResolvedGlassValue(unit.value_glass_type ?? projectGlass))
      : isResolvedGlassValue(projectGlass);

    if (!isChosen) {
      throw new AppError(
        activeUnits.length > 1
          ? 'Select a glass type for every active unit before approving Stage 2'
          : 'Select a glass type before approving Stage 2',
        StatusCodes.BAD_REQUEST,
      );
    }
  }

  async approveStage(
    projectId: string,
    stage: WorkflowStage,
    approvedBy: string,
    userRole?: string
  ): Promise<any> {
    const currentSchema = await this.proposalRepo.getCurrentSchema(projectId);
    if (stage === 7) {
      await this._authorizeStage7Approval(projectId, approvedBy, userRole, currentSchema);
    } else {
      await this._ensureEstimatorAssigned(projectId, approvedBy, userRole);
    }

    this._checkPrerequisite(currentSchema, stage);

    if (stage === 2) {
      this._assertGlassTypeChosen(currentSchema);
    }

    if (stage === 4) {
      const globalCrossbeam = currentSchema.stage_4.crossbeam?.value;
      const activeUnits = Object.values(currentSchema.units ?? {}).filter(hasRealUnitData);
      const unresolvedUnit = activeUnits.find((unit) =>
        !isResolvedCrossbeamValue(unit.value_cross_beam ?? globalCrossbeam),
      );
      const crossbeamIsResolved = activeUnits.length > 0
        ? !unresolvedUnit
        : isResolvedCrossbeamValue(globalCrossbeam);

      if (!crossbeamIsResolved) {
        throw new AppError(
          activeUnits.length > 1
            ? 'Select a crossbeam series or No Beam for every active unit before approving Stage 4'
            : 'Select a crossbeam series or No Beam before approving Stage 4',
          StatusCodes.BAD_REQUEST,
        );
      }
    }
    
    // We create an empty patch just to trigger a version, unless formula engine patches things
    let nextSchema = structuredClone(currentSchema) as IProjectSchema;
    let changedPaths: string[] = [];

    (nextSchema.pipeline_status as any)[`stage_${stage}_status`] = 'APPROVED';

    if (stage === 1 && nextSchema.stage_1?.person_quoting && !nextSchema.stage_1.person_quoting.value) {
      const project = await this.projectRepo.findById(projectId);
      const defaultEstimator = this._resolveEstimatorNames(project)[0] || null;
      if (defaultEstimator) {
        nextSchema.stage_1.person_quoting.value = defaultEstimator;
      }
    }

    if (stage === 4) {
      // Materialize only contract-valid project defaults for one real unit.
      // This keeps the approved schema, pricing, proposal, and UI aligned
      // without changing multi-unit projects or human overrides.
      changedPaths.push(...this._applySingleUnitProjectDefaults(nextSchema));
    }

    if (stage > 0 && stage <= 7) {
      this._approveFieldsRecursively((nextSchema as any)[`stage_${stage}`]);
    }
    if (stage === 4) {
      // Takeoff units are stored at the schema root, but they belong to stage 4 approval.
      this._approveFieldsRecursively(nextSchema.units);
    }
    
    // Unlock next stage
    if (stage < 6) {
      const nextStage = stage + 1;
      (nextSchema.pipeline_status as any)[`stage_${nextStage}_status`] = 'PENDING';
      
      if (stage === 5) {
        // Auto-approve Stage 6 since it is an internal mapping stage
        (nextSchema.pipeline_status as any)[`stage_6_status`] = 'APPROVED';
        (nextSchema.pipeline_status as any)[`stage_7_status`] = 'PENDING';
        changedPaths.push('pipeline_status.stage_6_status', 'pipeline_status.stage_7_status');
      }
    }

    if (stage === 4) {
      // Trigger calculation
      const calculatedPatches = await this.formulaEngine.recalculate(nextSchema);
      if (calculatedPatches && calculatedPatches.length > 0) {
        const patchResult = applyPatches(nextSchema, calculatedPatches, {
          source: 'AI', // Considered AI/System
          updatedBy: 'system'
        });
        nextSchema = patchResult.nextSchema;
        changedPaths = [...changedPaths, ...patchResult.changedFieldPaths];
      }
    }

    if (stage === 7) {
      // Sync quantity overrides back to stage_5.calculated upon stage 7 approval
      const qtyOverrides = nextSchema.stage_7?.quantity_overrides ?? {};
      if (Object.keys(qtyOverrides).length > 0) {
        if (!nextSchema.stage_5) {
          nextSchema.stage_5 = { _signals: {}, addons: {}, calculated: {} } as any;
        }
        if (!nextSchema.stage_5.calculated) {
          nextSchema.stage_5.calculated = {} as any;
        }

        // Check Glass cells (C9 - C14) -> update total_sqft
        const glassCells = ['C9', 'C10', 'C11', 'C12', 'C13', 'C14'];
        for (const gc of glassCells) {
          if (qtyOverrides[gc] !== undefined && Number.isFinite(qtyOverrides[gc])) {
            const newSqft = Number(qtyOverrides[gc]);
            if (!nextSchema.stage_5.calculated.total_sqft) {
              nextSchema.stage_5.calculated.total_sqft = { value: newSqft, status: 'APPROVED' } as any;
            } else {
              nextSchema.stage_5.calculated.total_sqft.value = newSqft;
              nextSchema.stage_5.calculated.total_sqft.status = 'APPROVED';
            }
            changedPaths.push('stage_5.calculated.total_sqft');
            break;
          }
        }

        // Check Framing cells (C38 - C50) -> update perimeter_lf
        const frameCells = ['C38', 'C39', 'C40', 'C41', 'C42', 'C43', 'C44', 'C45', 'C46', 'C47', 'C48', 'C49', 'C50'];
        for (const fc of frameCells) {
          if (qtyOverrides[fc] !== undefined && Number.isFinite(qtyOverrides[fc])) {
            const newPerimeter = Number(qtyOverrides[fc]);
            if (!nextSchema.stage_5.calculated.perimeter_lf) {
              nextSchema.stage_5.calculated.perimeter_lf = { value: newPerimeter, status: 'APPROVED' } as any;
            } else {
              nextSchema.stage_5.calculated.perimeter_lf.value = newPerimeter;
              nextSchema.stage_5.calculated.perimeter_lf.status = 'APPROVED';
            }
            changedPaths.push('stage_5.calculated.perimeter_lf');
            break;
          }
        }

        // Check Silicone (C64) -> update silicone_tubes
        if (qtyOverrides['C64'] !== undefined && Number.isFinite(qtyOverrides['C64'])) {
          const newSilicone = Number(qtyOverrides['C64']);
          if (!nextSchema.stage_5.calculated.silicone_tubes) {
            nextSchema.stage_5.calculated.silicone_tubes = { value: newSilicone, status: 'APPROVED' } as any;
          } else {
            nextSchema.stage_5.calculated.silicone_tubes.value = newSilicone;
            nextSchema.stage_5.calculated.silicone_tubes.status = 'APPROVED';
          }
          changedPaths.push('stage_5.calculated.silicone_tubes');
        }

        // Check Man Hours (C71) -> update total_man_hours
        if (qtyOverrides['C71'] !== undefined && Number.isFinite(qtyOverrides['C71'])) {
          const newManHours = Number(qtyOverrides['C71']);
          if (!nextSchema.stage_5.calculated.total_man_hours) {
            nextSchema.stage_5.calculated.total_man_hours = { value: newManHours, status: 'APPROVED' } as any;
          } else {
            nextSchema.stage_5.calculated.total_man_hours.value = newManHours;
            nextSchema.stage_5.calculated.total_man_hours.status = 'APPROVED';
          }
          changedPaths.push('stage_5.calculated.total_man_hours');
        }

        // Check Packaging (C73) -> update total_packaging
        if (qtyOverrides['C73'] !== undefined && Number.isFinite(qtyOverrides['C73'])) {
          const newPackaging = Number(qtyOverrides['C73']);
          if (!nextSchema.stage_5.calculated.total_packaging) {
            nextSchema.stage_5.calculated.total_packaging = { value: newPackaging, status: 'APPROVED' } as any;
          } else {
            nextSchema.stage_5.calculated.total_packaging.value = newPackaging;
            nextSchema.stage_5.calculated.total_packaging.status = 'APPROVED';
          }
          changedPaths.push('stage_5.calculated.total_packaging');
        }
      }

      const generated = await this._generateAndPersistProposalExcel(
        projectId,
        nextSchema,
        approvedBy
      );
      nextSchema = generated.nextSchema;
      changedPaths.push('stage_7', 'stage_6_proposal', 'pipeline_status.stage_7_status');

      // Best-effort display-name resolution — a lookup failure must not block
      // the approval itself, which has already been authorized.
      const approverUser = await userRepository.findById(approvedBy).catch(() => null);
      const approverName = approverUser ? `${approverUser.firstName} ${approverUser.lastName}`.trim() : null;
      if (!nextSchema.stage_7) {
        nextSchema.stage_7 = { status: 'APPROVED', cost_overrides: {} };
      }
      if (!nextSchema.stage_7.approval) {
        nextSchema.stage_7.approval = {};
      }
      nextSchema.stage_7.approval.approvedBy = approvedBy;
      nextSchema.stage_7.approval.approvedByName = approverName;
      nextSchema.stage_7.approval.approvedAt = new Date();

      const finalPrice = this.computeStage7ThresholdPrice(nextSchema);
      await this.auditLogService?.recordBestEffort({
        action: 'proposal.stage7_approved',
        category: AuditLogCategory.APPROVAL,
        visibility: AuditLogVisibility.BASIC,
        actorId: approvedBy,
        actorRole: userRole as any,
        projectId,
        targetType: 'PROJECT',
        targetId: projectId,
        description: `${approverName ?? 'A user'} approved Stage 7 (final price $${finalPrice ?? 'n/a'})`,
        metadata: {
          finalPrice,
          threshold: env.proposalApproval.highValueThreshold,
          requiredNamedApprover: typeof finalPrice === 'number' && finalPrice > env.proposalApproval.highValueThreshold,
        },
        source: AuditLogSource.API,
      });
    }

    await this.proposalRepo.appendVersion({
      projectId,
      nextSchema,
      changedFieldPaths: changedPaths,
      source: 'ESTIMATOR',
      updatedBy: approvedBy,
      stage,
      approvalStatus: 'APPROVED'
    });

    if (stage === 7) {
      await this._markProjectCompleted(projectId, approvedBy, nextSchema);
      const assignedApproverId = nextSchema.stage_7?.approval?.approverId;
      if (assignedApproverId) {
        await notificationService.resolveStage7ApprovalRequests(projectId, assignedApproverId);
      }
    } else {
      const project = await this.projectRepo.findById(projectId);
      if (
        project &&
        (project.status === ProjectStatus.READY_FOR_ESTIMATOR ||
          project.status === ProjectStatus.WAITING_FOR_INPUTS ||
          project.status === ProjectStatus.NEEDS_REVISION)
      ) {
        await this.projectRepo.updateById(projectId, {
          status: stage >= 6 ? ProjectStatus.ESTIMATOR_FINAL : ProjectStatus.ESTIMATOR_DRAFTING,
          analysisStatus: ProjectAnalysisStatus.COMPLETED,
          revisionRequest: project.status === ProjectStatus.NEEDS_REVISION ? null : project.revisionRequest,
        });
      } else if (project && project.status === ProjectStatus.ESTIMATOR_DRAFTING && stage >= 6) {
        await this.projectRepo.updateById(projectId, {
          status: ProjectStatus.ESTIMATOR_FINAL,
          analysisStatus: ProjectAnalysisStatus.COMPLETED,
        });
      }
    }

    proposalEventBus.emit(ProposalEvent.STAGE_APPROVED, {
      projectId,
      data: { stage, status: 'APPROVED' },
    });

    let triggerToFire: PipelineTrigger | null = null;
    let targetStage: 1 | 2 | 3 | 4 | 5 | 6 | 'EXCEL' | null = null;

    if (stage === 1) {
      triggerToFire = PipelineTrigger.STAGE_1_APPROVED_START_2;
      targetStage = 2;
    } else if (stage === 2) {
      triggerToFire = PipelineTrigger.STAGE_2_APPROVED_START_3;
      targetStage = 3;
    } else if (stage === 3) {
      triggerToFire = PipelineTrigger.STAGE_3_APPROVED_START_4;
      targetStage = 4;
    } else if (stage === 4) {
      triggerToFire = PipelineTrigger.STAGE_4_APPROVED_START_5;
      targetStage = 5;
    } else if (stage === 5) {
      triggerToFire = PipelineTrigger.STAGE_5_APPROVED_START_6;
      targetStage = 6;
      // Stage 6 is auto-approved, so we directly initialize Stage 7
      await this.initializeStage7(projectId);
    } else if (stage === 6) {
      // Stage 7 is self-initializing from the Excel template
      await this.initializeStage7(projectId);
    }

    if (triggerToFire && targetStage) {
      try {
        // Idempotency key must be unique per revise/re-approve cycle, otherwise Azure
        // Service Bus dedup can silently drop re-run triggers. The revised stage's
        // revision count advances on every unapprove, guaranteeing a fresh key.
        const proposalDoc = await this.proposalRepo.findByProjectId(projectId);
        const revisionSeq = proposalDoc?.revisions?.[`stage_${stage}` as keyof typeof proposalDoc.revisions]?.length ?? 0;
        const idempotencyKey = `${projectId}:${triggerToFire}:${revisionSeq}`;
        await this.triggerPublisher.publish({
          trigger: triggerToFire,
          projectId,
          targetStage,
          triggeredAt: new Date().toISOString(),
          triggeredBy: 'ESTIMATOR',
          idempotencyKey,
        });
      } catch (err) {
        console.error(`Failed to publish trigger ${triggerToFire} for project ${projectId}:`, err);
        // Do not fail the approval if publish fails.
        // Surface STAGE_RUN_FAILED event to frontend if needed
        proposalEventBus.emit('STAGE_RUN_FAILED' as any, {
          projectId,
          data: { stage: targetStage, error: 'Failed to start AI run' },
        });
      }
    }

    if (stage === 5) {
      proposalEventBus.emit(ProposalEvent.STAGE_APPROVED, {
        projectId,
        data: { stage: 6, status: 'APPROVED' },
      });
    }

    return { stage, status: 'APPROVED' };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // ESTIMATOR: UNAPPROVE STAGE (REVISE)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Stage 7 must never stay open (or approved) while an earlier stage is
   * unapproved. Approving Stage 5 re-opens it as PENDING, so this only closes
   * the window a re-extraction/AI push leaves. An approved Stage 7 is fully
   * invalidated, including the fields the download gate also reads.
   */
  private _lockStage7IfUpstreamOpen(schema: IProjectSchema, changedPaths: string[]): void {
    const upstreamOpen = [1, 2, 3, 4, 5].some(
      (n) => (schema.pipeline_status as any)?.[`stage_${n}_status`] !== 'APPROVED',
    );
    const current = schema.pipeline_status?.stage_7_status;
    if (!upstreamOpen || !current || current === 'LOCKED') return;

    schema.pipeline_status.stage_7_status = 'LOCKED';
    changedPaths.push('pipeline_status.stage_7_status');
    if (schema.stage_7) {
      this._invalidateStageFields(schema.stage_7);
      if (schema.stage_7.approval) {
        schema.stage_7.approval.approvedBy = null;
        schema.stage_7.approval.approvedByName = null;
        schema.stage_7.approval.approvedAt = null;
      }
      changedPaths.push('stage_7');
    }
  }

  private _invalidateStageFields(obj: any): void {
    if (typeof obj !== 'object' || obj === null) return;
    if ('status' in obj && obj.status === 'APPROVED') {
      obj.status = 'PENDING';
    }
    for (const key of Object.keys(obj)) {
      this._invalidateStageFields(obj[key]);
    }
  }

  async unapproveStage(
    projectId: string,
    stage: WorkflowStage,
    unapprovedBy: string,
    userRole?: string,
    reason?: string
  ): Promise<any> {
    await this._ensureEstimatorAssigned(projectId, unapprovedBy, userRole);
    const currentSchema = await this.proposalRepo.getCurrentSchema(projectId);

    const currentStatus = (currentSchema.pipeline_status as any)[`stage_${stage}_status`];
    if (currentStatus !== 'APPROVED') {
      throw new AppError(`Stage ${stage} is not approved`, StatusCodes.BAD_REQUEST);
    }

    const nextSchema = structuredClone(currentSchema) as IProjectSchema;
    const changedPaths: string[] = [];

    // Set current stage to PENDING
    (nextSchema.pipeline_status as any)[`stage_${stage}_status`] = 'PENDING';
    changedPaths.push(`pipeline_status.stage_${stage}_status`);

    // Set all subsequent stages to LOCKED, except stage 6 which should be PENDING
    // (unless unapprove is called on stage 7, in which case the loop doesn't reach s=6)
    for (let s = stage + 1; s <= 7; s++) {
      if ((nextSchema.pipeline_status as any)[`stage_${s}_status`]) {
        if (s === 6) {
          (nextSchema.pipeline_status as any)[`stage_6_status`] = 'PENDING';
        } else {
          (nextSchema.pipeline_status as any)[`stage_${s}_status`] = 'LOCKED';
        }
        changedPaths.push(`pipeline_status.stage_${s}_status`);
      }
    }

    // Invalidate-but-keep: flip field approval statuses APPROVED -> PENDING for the
    // revised stage and all downstream stages so they visibly need re-approval during
    // the walk-forward. Stage 6 internal cells are skipped (AI-regenerated, not estimator fields).
    for (let s = stage; s <= 7; s++) {
      if (s === 6) continue;
      const stageData = (nextSchema as any)[`stage_${s}`];
      if (stageData && typeof stageData === 'object') {
        this._invalidateStageFields(stageData);
        changedPaths.push(`stage_${s}`);
      }
      // Stage 7's approval record is preserved across revision (the assigned
      // approver doesn't need to be reassigned to re-review), but a stale
      // "approved by" must not linger once the approval itself is undone.
      if (s === 7 && nextSchema.stage_7?.approval) {
        nextSchema.stage_7.approval.approvedBy = null;
        nextSchema.stage_7.approval.approvedByName = null;
        nextSchema.stage_7.approval.approvedAt = null;
      }
    }
    // Takeoff units live at the schema root but belong to Stage 4 approval.
    if (stage === 4 && nextSchema.units) {
      this._invalidateStageFields(nextSchema.units);
      changedPaths.push('units');
    }

    await this.proposalRepo.appendVersion({
      projectId,
      nextSchema,
      changedFieldPaths: changedPaths,
      source: 'ESTIMATOR',
      updatedBy: unapprovedBy,
      stage
    });

    await this.proposalRepo.appendRevision({
      projectId,
      stage,
      reason: reason ?? '',
      revisedBy: unapprovedBy,
    });

    const project = await this.projectRepo.findById(projectId);
    if (project) {
      await this.projectRepo.updateById(projectId, {
        status: ProjectStatus.NEEDS_REVISION,
        revisionRequest: {
          stage,
          reason: reason?.trim() || null,
          requestedBy: unapprovedBy,
          requestedAt: new Date(),
        },
      });
    }

    proposalEventBus.emit(ProposalEvent.STAGE_PUSHED, {
      projectId,
      data: { stage, status: 'PENDING' }
    });

    proposalEventBus.emit(ProposalEvent.STAGE_REOPENED, {
      projectId,
      data: { stage, status: 'PENDING', reason: reason ?? '' },
    });

    const fieldsToShow = this._filterFieldsToShow(nextSchema, stage);
    return {
      stage,
      status: 'PENDING',
      fields_to_show: fieldsToShow
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // HISTORY
  // ───────────────────────────────────────────────────────────────────────────

  async getHistory(projectId: string): Promise<any> {
    return this.proposalRepo.getVersionHistory(projectId);
  }

  async getVersion(projectId: string, version: number): Promise<any> {
    return this.proposalRepo.getVersion(projectId, version);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // PROPOSAL DOCUMENT (Proposal sheet cells + persisted workbook)
  // ───────────────────────────────────────────────────────────────────────────

  async getProposal(
    projectId: string,
    userId: string,
    userRole?: string,
  ): Promise<{
    stage_6_proposal: IProjectSchema['stage_6_proposal'];
    latest_document: any;
    documents: any[];
    quotation_history: QuotationHistoryItem[];
    lead_approval: LeadApproval;
    send_readiness: ProposalSendReadiness;
  }> {
    const project = await this._ensureEstimatorAssigned(projectId, userId, userRole);

    const schema = await this.proposalRepo.getCurrentSchema(projectId);
    const [latestDocument, documents] = await Promise.all([
      this._getLatestQuoteDocument(projectId, schema),
      this._listQuoteDocuments(projectId),
    ]);
    const sendReadiness = this._proposalSendReadiness(schema, Boolean(latestDocument));

    return {
      stage_6_proposal: schema.stage_6_proposal,
      latest_document: latestDocument,
      documents,
      quotation_history: this._buildQuotationHistory(documents, schema, latestDocument),
      lead_approval: deriveLeadApproval(project),
      send_readiness: sendReadiness,
    };
  }

  /**
   * Complete the proposal handoff by marking the project's Zoho lead as quoted.
   *
   * Manager approval and a final-output action are enforced before Zoho is changed.
   */
  async approveProposalLead(projectId: string, userId: string, userRole?: string): Promise<LeadApproval> {
    const project = await this._ensureEstimatorAssigned(projectId, userId, userRole);
    const schema = await this._ensureStage7DownloadApproved(projectId);
    const draft = await this._getLatestQuoteDocument(projectId, schema);

    if (!draft) {
      throw new AppError(
        'Generate a proposal draft before sending.',
        StatusCodes.UNPROCESSABLE_ENTITY,
        true,
        { code: ErrorCode.VALIDATION_ERROR },
      );
    }

    const sendReadiness = this._proposalSendReadiness(schema, Boolean(draft));

    if (!sendReadiness.canSend) {
      throw new AppError(
        sendReadiness.reason ?? 'The proposal is not ready to send.',
        StatusCodes.UNPROCESSABLE_ENTITY,
        true,
        { code: ErrorCode.VALIDATION_ERROR },
      );
    }

    if (!this.leadStatus) {
      throw new AppError('Lead status updates are not configured.', StatusCodes.NOT_IMPLEMENTED);
    }

    let result: Awaited<ReturnType<LeadStatusMarker['markQuotedNeedsFollowUp']>>;
    try {
      result = await this.leadStatus.markQuotedNeedsFollowUp(projectId);
    } catch (err) {
      // The mirror is only written after Zoho accepts, so "nothing was changed" is true.
      throw new AppError(
        'Could not update the Zoho lead. Nothing was changed, please try again.',
        StatusCodes.BAD_GATEWAY,
        true,
        { details: err instanceof Error ? err.message : String(err) },
      );
    }

    if (result.reason === 'lead-read-failed') {
      throw new AppError(
        'Could not reach Zoho to check the lead status. Nothing was changed, please try again.',
        StatusCodes.BAD_GATEWAY,
      );
    }

    await this._markProposalSent(projectId, userId);

    return {
      ...deriveLeadApproval({
        zohoLeadId: project.zohoLeadId,
        leadStatus: result.status ?? project.leadStatus,
      }),
      changed: result.updated,
    };
  }

  async getProposalDocumentFile(
    projectId: string,
    userId: string,
    userRole: string | undefined,
    documentId: string,
  ): Promise<{ buffer: Buffer; fileName: string }> {
    await this._ensureEstimatorAssigned(projectId, userId, userRole);
    await this._ensureStage7DownloadApproved(projectId);

    const doc = await DocumentModel.findOne({
      _id: documentId,
      projectId: new mongoose.Types.ObjectId(projectId),
      documentType: DocumentTypeTag.QUOTE,
      isActive: true,
    }).lean();

    if (!doc) {
      throw new AppError('Proposal document not found', StatusCodes.NOT_FOUND, true, { code: ErrorCode.NOT_FOUND });
    }

    if (!this.blobStorage) {
      throw new AppError('Blob storage not configured', StatusCodes.INTERNAL_SERVER_ERROR);
    }

    const downloaded = await this.blobStorage.download(doc.storageKey);
    const chunks: Buffer[] = [];
    for await (const chunk of downloaded.stream as AsyncIterable<Buffer>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as unknown as ArrayBuffer));
    }
    const buffer = Buffer.concat(chunks);

    await this._markProjectCompleted(projectId, userId);
    await this._markProposalOutputAction(projectId, userId);

    return { buffer, fileName: doc.originalName };
  }

  // Serves a PDF of just the customer-facing Proposal sheet for a
  // previously generated draft — used only by the "Download" action (the
  // in-app draft preview keeps using getProposalDocumentFile's raw xlsx).
  // Converts via Graph on first request and caches the result on the same
  // Document record so repeat downloads skip the Graph round-trip.
  async getProposalDocumentPdf(
    projectId: string,
    userId: string,
    userRole: string | undefined,
    documentId: string,
  ): Promise<{ buffer: Buffer; fileName: string }> {
    await this._ensureEstimatorAssigned(projectId, userId, userRole);
    await this._ensureStage7DownloadApproved(projectId);

    const doc = await DocumentModel.findOne({
      _id: documentId,
      projectId: new mongoose.Types.ObjectId(projectId),
      documentType: DocumentTypeTag.QUOTE,
      isActive: true,
    });

    if (!doc) {
      throw new AppError('Proposal document not found', StatusCodes.NOT_FOUND, true, { code: ErrorCode.NOT_FOUND });
    }

    if (!this.blobStorage) {
      throw new AppError('Blob storage not configured', StatusCodes.INTERNAL_SERVER_ERROR);
    }

    const pdfFileName = doc.originalName.replace(/\.xlsx$/i, '.pdf');

    if (doc.pdfStorageKey) {
      const downloaded = await this.blobStorage.download(doc.pdfStorageKey);
      const chunks: Buffer[] = [];
      for await (const chunk of downloaded.stream as AsyncIterable<Buffer>) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as unknown as ArrayBuffer));
      }
      await this._markProjectCompleted(projectId, userId);
      await this._markProposalOutputAction(projectId, userId);
      return { buffer: Buffer.concat(chunks), fileName: pdfFileName };
    }

    const downloadedXlsx = await this.blobStorage.download(doc.storageKey);
    const xlsxChunks: Buffer[] = [];
    for await (const chunk of downloadedXlsx.stream as AsyncIterable<Buffer>) {
      xlsxChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as unknown as ArrayBuffer));
    }
    const xlsxBuffer = Buffer.concat(xlsxChunks);

    const schema = await this.proposalRepo.getCurrentSchema(projectId);
    const targetSheet = schema?.stage_6_proposal?.target_sheet || 'Proposal';
    const pdfBuffer = await convertProposalSheetToPdf(xlsxBuffer, targetSheet);

    try {
      const sha256 = crypto.createHash('sha256').update(pdfBuffer).digest('hex');
      const putResult = await this.blobStorage.put({
        projectId,
        sha256,
        originalName: pdfFileName,
        mimeType: 'application/pdf',
        buffer: pdfBuffer,
      });
      doc.pdfStorageKey = putResult.storageKey;
      doc.pdfBlobUrl = putResult.blobUrl;
      doc.pdfByteSize = pdfBuffer.length;
      await doc.save();
    } catch (err: any) {
      console.warn(`[Proposal] Failed to cache generated PDF for document ${documentId}:`, err?.message ?? err);
    }

    await this._markProjectCompleted(projectId, userId);
    await this._markProposalOutputAction(projectId, userId);

    return { buffer: pdfBuffer, fileName: pdfFileName };
  }

  async getLatestProposalDownload(
    projectId: string,
    userId: string,
    userRole?: string,
    options?: { force?: boolean },
  ): Promise<{ document: any; download_url: string | null }> {
    await this._ensureEstimatorAssigned(projectId, userId, userRole);
    let schema = await this._ensureStage7DownloadApproved(projectId);

    let doc = options?.force ? null : await this._getLatestQuoteDocument(projectId, schema);
    if (!doc && schema && schema.pipeline_status?.stage_5_status === 'APPROVED') {
      const generated = await this._generateAndPersistProposalExcel(projectId, schema, userId);
      schema = generated.nextSchema;
      doc = await this._getLatestQuoteDocument(projectId, schema);
    }
    if (!doc) {
      throw new AppError('No generated proposal found', StatusCodes.NOT_FOUND, true, { code: ErrorCode.NOT_FOUND });
    }

    const downloadUrl = this.blobStorage
      ? await this.blobStorage.createSignedDownloadUrl(doc.storageKey, 60, { fileName: doc.originalName })
      : null;

    // Requesting the signed final proposal is also a successful proposal
    // delivery path. This covers clients that download through the signed URL
    // instead of the streamed Excel endpoint.
    await this._markProjectCompleted(projectId, userId);
    if (downloadUrl) {
      await this._markProposalOutputAction(projectId, userId);
    }

    return { document: doc, download_url: downloadUrl };
  }

  // NOTE: adjusted from dev's original — that version relied on `isLatest: true`
  // to find the most recent proposal. Since we intentionally keep every
  // generated proposal as isLatest: true (see _persistGeneratedProposal, so
  // outwardSync never deletes an older version from Dropbox), `isLatest` can no
  // longer uniquely identify "the latest one." We sort by createdAt instead.
  private async _getLatestQuoteDocument(projectId: string, schema?: IProjectSchema): Promise<any | null> {
    const doc = await DocumentModel.findOne({
      projectId: new mongoose.Types.ObjectId(projectId),
      documentType: DocumentTypeTag.QUOTE,
      isActive: true,
    })
      .sort({ createdAt: -1 })
      .lean();

    if (doc && schema && !this._isGeneratedProposalCurrent(schema, doc)) {
      return null;
    }

    return doc;
  }

  private _isGeneratedProposalCurrent(schema: IProjectSchema | undefined, document: any): boolean {
    // Legacy read-only tests/projects may not have a proposal schema yet. In
    // that case preserve the existing stored-document behavior.
    if (!schema) return true;

    const documentCreatedAt = document?.createdAt ?? document?.created_at;
    if (!documentCreatedAt) return false;

    // Invalidate any proposal document created before the production template alignment fix
    const engineVersion = (document as any)?.metadata?.engineVersion;
    if (engineVersion !== PROPOSAL_ENGINE_VERSION &&
        new Date(documentCreatedAt).getTime() < PROPOSAL_ENGINE_CUTOFF_MS) {
      return false;
    }

    const schemaUpdatedAt = schema.stage_7?.updated_at;
    if (!schemaUpdatedAt) return true;

    return new Date(documentCreatedAt).getTime() >= new Date(schemaUpdatedAt).getTime();
  }

  private async _listQuoteDocuments(projectId: string, limit = 20): Promise<any[]> {
    return DocumentModel.find({
      projectId: new mongoose.Types.ObjectId(projectId),
      documentType: DocumentTypeTag.QUOTE,
      isActive: true,
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
  }

  private _quoteNumberForDocument(document: any): string | null {
    const metadataNumber = document?.metadata?.quoteNumber;
    if (typeof metadataNumber === 'string' && metadataNumber.trim()) return metadataNumber.trim();

    const match = String(document?.originalName ?? '').match(/Proposal\s*#\s*([^\.]+)\.xlsx$/i);
    return match?.[1]?.trim() || null;
  }

  private _buildQuotationHistory(
    documents: any[],
    schema: IProjectSchema,
    latestDocument: any | null,
  ): QuotationHistoryItem[] {
    const output = schema.stage_6_proposal;
    const approval = schema.stage_7?.approval;
    const currentDocumentId = latestDocument?._id?.toString?.() ?? null;
    const currentAmount = this.computeProposalPrice(schema);

    return documents.map((document) => {
      const documentId = document?._id?.toString?.() ?? String(document?._id ?? '');
      const isCurrent = documentId === currentDocumentId;
      const generatedAt = document.uploadedAt ?? document.createdAt;
      const storedAmount = Number(document?.metadata?.finalPrice);
      const amount = Number.isFinite(storedAmount) && storedAmount > 0
        ? storedAmount
        : isCurrent
          ? currentAmount
          : null;
      const events: QuotationHistoryItem['events'] = [{
        type: 'GENERATED',
        occurredAt: generatedAt,
        actorId: document.uploadedBy ?? null,
      }];

      if (isCurrent && approval?.approvedAt) {
        events.push({
          type: 'MANAGER_APPROVED',
          occurredAt: approval.approvedAt,
          actorId: approval.approvedBy ?? null,
          actorName: approval.approvedByName ?? null,
        });
      }
      if (isCurrent && output?.output_action_at) {
        events.push({
          type: 'FINAL_OUTPUT_ACTIONED',
          occurredAt: output.output_action_at,
          actorId: output.output_action_by ?? null,
        });
      }
      if (isCurrent && output?.sent_at) {
        events.push({
          type: 'SENT',
          occurredAt: output.sent_at,
          actorId: output.sent_by ?? null,
        });
      }

      const status: QuotationHistoryItem['status'] = !isCurrent
        ? 'SUPERSEDED'
        : output?.sent_at
          ? 'SENT'
          : output?.output_action_at
            ? 'ACTIONED'
            : approval?.approvedAt
              ? 'APPROVED'
              : 'GENERATED';

      return {
        documentId,
        quoteNumber: this._quoteNumberForDocument(document),
        fileName: document.originalName,
        generatedAt,
        generatedBy: document.uploadedBy ?? null,
        amount,
        status,
        isCurrent,
        events,
      };
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // GENERATE EXCEL
  // ───────────────────────────────────────────────────────────────────────────

  async generateExcel(
    projectId: string,
    userId: string,
    userRole?: string,
    options?: { force?: boolean }
  ): Promise<{ buffer: Buffer; fileName: string }> {
    await this._ensureEstimatorAssigned(projectId, userId, userRole);
    const schema = await this._ensureStage7DownloadApproved(projectId);

    // 1. Serve the stored workbook only while it still represents the current
    // Stage 7 inputs and has not been marked stale by an engine update.
    if (!options?.force) {
      const latestDoc = await this._getLatestQuoteDocument(projectId, schema);
      if (latestDoc && this.blobStorage) {
        const downloaded = await this.blobStorage.download(latestDoc.storageKey);
        const chunks: Buffer[] = [];
        for await (const chunk of downloaded.stream as AsyncIterable<Buffer>) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as unknown as ArrayBuffer));
        }
        const buffer = Buffer.concat(chunks);
        await this._markProjectCompleted(projectId, userId);
        await this._markProposalOutputAction(projectId, userId);
        return { buffer, fileName: latestDoc.originalName };
      }
    }

    // 2. Fallback generation (legacy projects, pre-stage-7 downloads, or auto-healing stale quotes)
    if (schema.pipeline_status.stage_5_status !== 'APPROVED') {
      throw new AppError(
        'Cannot generate Excel: Stage 5 is not approved',
        StatusCodes.BAD_REQUEST,
        true,
        { code: ErrorCode.VALIDATION_ERROR }
      );
    }

    const project = await this.projectRepo.findById(projectId);
    if (!project) {
      throw new AppError('Project not found', StatusCodes.NOT_FOUND);
    }

    const quoteNumber = project.quoteNumber || await this.quoteNumberingService.previewNextQuoteNumber(projectId);
    const estimatorName = schema.stage_1?.person_quoting?.value
      || this._resolveEstimatorNames(project)[0]
      || undefined;
    const calculation = calculateFinalParameters(schema, schema.stage_7?.cost_overrides ?? {});
    const generation = await generateProposalExcelWithFallback(schema, quoteNumber, estimatorName, calculation);
    const buffer = generation.buffer;

    const dateStr = new Intl.DateTimeFormat('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' }).format(new Date()).replace(/\//g, '.');
    const address = schema.stage_1?.project_address?.value || 'Unknown Address';
    const contactName = schema.stage_1?.contact_name?.value || 'Unknown Contact';

    const safeAddress = address.replace(/[<>:"/\\|?*\n\r]/g, ' ').replace(/\s+/g, ' ').trim();
    const safeContact = contactName.replace(/[<>:"/\\|?*\n\r]/g, ' ').replace(/\s+/g, ' ').trim();
    const safeQuote = quoteNumber.replace(/[<>:"/\\|?*\n\r]/g, ' ').replace(/\s+/g, ' ').trim();

    const fileName = `${dateStr} - ${safeAddress} - ${safeContact} - Glass Flooring Systems Proposal #${safeQuote}.xlsx`;

    try {
      await this._persistGeneratedProposal(projectId, userId, fileName, buffer, {
        quoteNumber,
        finalPrice: calculation.grandTotal,
      });
    } catch (err: any) {
      console.warn(`[Proposal] Failed to persist refreshed proposal to blob storage for ${projectId}:`, err?.message ?? err);
    }

    if (calculation.finalPrice > 0) {
      if (!schema.stage_7) {
        schema.stage_7 = { status: 'READY', cost_overrides: {} };
      }
      schema.stage_7.computed_snapshot = {
        subtotal: calculation.subtotal,
        total: calculation.total,
        final_price: calculation.finalPrice,
        optional_add_on_total: calculation.optionalAddOnTotal,
        grand_total: calculation.grandTotal,
      };
      schema.stage_7.updated_at = new Date();
      await this.proposalRepo.appendVersion({
        projectId,
        nextSchema: schema,
        changedFieldPaths: ['stage_7.computed_snapshot'],
        source: 'AI',
        updatedBy: userId,
        stage: 7,
      }).catch((err) => {
        console.warn(`[Proposal] Failed to append version for refreshed snapshot:`, err?.message ?? err);
      });
      await this.projectRepo.updateById(projectId, { estimatedCost: calculation.grandTotal }).catch((err) => {
        console.warn(`[Proposal] Failed to update project estimatedCost for ${projectId}:`, err?.message ?? err);
      });
    }

    await this._markProjectCompleted(projectId, userId, schema);
    await this._markProposalOutputAction(projectId, userId);

    return { buffer, fileName };
  }

  private async _generateAndPersistProposalExcel(
    projectId: string,
    schema: IProjectSchema,
    userId: string,
  ): Promise<{ quoteNumber: string; fileName: string; buffer: Buffer; nextSchema: IProjectSchema; createdDocId: string | null }> {
    const project = await this.projectRepo.findById(projectId);
    const quoteNumber = await this.quoteNumberingService.issueNextQuoteNumber(projectId);
    const estimatorName = schema.stage_1?.person_quoting?.value
      || this._resolveEstimatorNames(project)[0]
      || undefined;
    const calculation = calculateFinalParameters(schema, schema.stage_7?.cost_overrides ?? {});
    const generation = await generateProposalExcelWithFallback(schema, quoteNumber, estimatorName, calculation);
    const buffer = generation.buffer;
    const generatedWorkbook = new ExcelJS.Workbook();
    await generatedWorkbook.xlsx.load(buffer as any);

    const nextSchema = structuredClone(schema) as IProjectSchema;
    const activeUnitCount = Object.values(schema.units ?? {}).filter(
      (unit) => unit && (
        unit.value_frame_type != null ||
        unit.value_glass_type != null ||
        unit.value_glass_thickness != null ||
        unit.value_width_in != null ||
        unit.value_length_in != null ||
        unit.value_panel_count != null
      ),
    ).length || 1;

    let finalPrice: number | null = null;

    if (generation.calculatedByGraph) {
      const computedSnapshot = await extractPricingSnapshot(generatedWorkbook, activeUnitCount);
      const hasUsableFinalPrice = computedSnapshot !== null
        && Number.isFinite(computedSnapshot.final_price)
        && computedSnapshot.final_price > 0;

      if (hasUsableFinalPrice) {
        finalPrice = computedSnapshot.final_price;
        // Validate against canonical contract to guard against template default pollution
        if (calculation.finalPrice > 0 && Math.abs(finalPrice - calculation.finalPrice) > 0.05) {
          console.warn(
            `[Proposal] Correcting drifted Graph final price (${finalPrice}) to canonical contract price (${calculation.finalPrice}) for project ${projectId}`,
          );
          finalPrice = calculation.finalPrice;
          computedSnapshot.final_price = calculation.finalPrice;
        }
        computedSnapshot.optional_add_on_total = calculation.optionalAddOnTotal;
        computedSnapshot.grand_total = calculation.grandTotal;

        if (!nextSchema.stage_7) {
          nextSchema.stage_7 = { status: 'READY', cost_overrides: {} };
        }
        nextSchema.stage_7.computed_snapshot = computedSnapshot;
        nextSchema.stage_7.updated_at = new Date();
      } else if (computedSnapshot) {
        console.warn(`[Proposal] Ignoring empty FINAL PRICE for project ${projectId}`);
      } else {
        console.warn(`[Proposal] Calculated FINAL PRICE was not found for project ${projectId}`);
      }
    } else {
      console.warn(
        `[Proposal] Excel generated locally for project ${projectId}; calculating final price from parameter schema fallback.`,
      );
    }

    if (!finalPrice || finalPrice <= 0) {
      finalPrice = calculation.finalPrice > 0 ? calculation.finalPrice : this.computeProposalPrice(nextSchema);
      if (finalPrice && finalPrice > 0) {
        if (!nextSchema.stage_7) {
          nextSchema.stage_7 = { status: 'READY', cost_overrides: {} };
        }
        nextSchema.stage_7.computed_snapshot = {
          ...(nextSchema.stage_7.computed_snapshot || {}),
          final_price: finalPrice,
          subtotal: calculation.subtotal,
          total: calculation.total,
          optional_add_on_total: calculation.optionalAddOnTotal,
          grand_total: calculation.grandTotal,
        };
        nextSchema.stage_7.updated_at = new Date();
      }
    }

    if (finalPrice && finalPrice > 0) {
      const updatedProject = await this.projectRepo.updateById(projectId, {
        estimatedCost: calculation.grandTotal > 0 ? calculation.grandTotal : finalPrice,
      });
      if (!updatedProject) {
        throw new AppError('Project not found while saving proposal value', StatusCodes.NOT_FOUND);
      }
    }

    await this.proposalRepo.logExcelGeneration({
      projectId,
      generatedBy: userId,
    });

    const proposalTargetSheet = nextSchema.stage_6_proposal?.target_sheet || 'Proposal';
    const rawComputedCells = await extractComputedProposalCells(generatedWorkbook, proposalTargetSheet);
    const proposalUnitCells = buildProposalUnitCells(nextSchema);

    // Unit grid rows 23-32 map 1:1 to units A-J. The Proposal sheet's own
    // formulas resolve to 0 for units the estimator never touched, so
    // extractComputedProposalCells (which harvests any finite number) would
    // otherwise pull "0" location/width/length values into the Edit Draft
    // preview for empty unit slots. Drop those rows here, mirroring the
    // hasRealUnitData gate that buildProposalUnitCells/hideEmptyUnitRows
    // already apply to what actually gets written/shown.
    const emptyUnitRows = new Set<number>();
    for (let i = 0; i < 10; i++) {
      const unitId = String.fromCharCode('A'.charCodeAt(0) + i);
      if (!hasRealUnitData(nextSchema.units?.[unitId])) emptyUnitRows.add(23 + i);
    }
    const computedCells = Object.fromEntries(
      Object.entries(rawComputedCells).filter(([address]) => {
        const rowNum = Number(/^[A-Z]+(\d+)$/.exec(address)?.[1]);
        return !emptyUnitRows.has(rowNum);
      }),
    );
    // Which glazing block (B35-40/B42-51/B53-62) applies and which addon
    // per-unit rows are real both get freshly re-derived every generation
    // (applySelectedGlazingBlock / hideEmptyAddonUnitRows, called inside
    // generateProposalExcelLocally/generateProposalExcel) by CLEARING the
    // cells that no longer apply — so extractComputedProposalCells correctly
    // omits them from computedCells. But carrying forward the *old*
    // schema.stage_6_proposal.cells for those same addresses below would
    // silently resurrect a glazing block/addon row that this generation
    // deliberately dropped (e.g. a frame_type change from Series 1000 to
    // Series 2000 would otherwise still show the old Series 1000 makeup
    // alongside the new one). Excluded here for the same reason the unit
    // grid (rows 23-32) already is below.
    const addonSectionBases = findAddonSectionUnitRowBases(generatedWorkbook.getWorksheet(proposalTargetSheet)!);
    const existingProposalCells = Object.fromEntries(
      Object.entries(nextSchema.stage_6_proposal?.cells ?? {}).filter(
        ([address, value]) =>
          !(/^K(2[3-9]|3[0-2])$/.test(address) && value === 'Description') &&
          !/^[A-Z]+(2[3-9]|3[0-2])$/.test(address) &&
          !/^B(3[5-9]|[45]\d|6[0-2])$/.test(address) &&
          // Every column of each addon section's header row and its 10 unit
          // rows — see isAddonSectionRowAddress for why the whole row needs
          // protecting, not just the $ column or the label column.
          !isAddonSectionRowAddress(address, addonSectionBases),
      ),
    );
    const mergedCells = {
      ...existingProposalCells,
      ...computedCells,
    };

    for (const [address, value] of Object.entries(proposalUnitCells)) {
      if (!(address in computedCells)) mergedCells[address] = value;
    }

    if (Object.keys(mergedCells).length > 0) {
      nextSchema.stage_6_proposal = {
        target_sheet: proposalTargetSheet,
        cells: mergedCells,
        status: nextSchema.stage_6_proposal?.status ?? 'READY_FOR_PROPOSAL_EXCEL',
        updated_at: new Date(),
      };
    }

    const dateStr = new Intl.DateTimeFormat('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' }).format(new Date()).replace(/\//g, '.');
    const address = nextSchema.stage_1?.project_address?.value || 'Unknown Address';
    const contactName = nextSchema.stage_1?.contact_name?.value || 'Unknown Contact';

    const safeAddress = address.replace(/[<>:"/\\|?*\n\r]/g, ' ').replace(/\s+/g, ' ').trim();
    const safeContact = contactName.replace(/[<>:"/\\|?*\n\r]/g, ' ').replace(/\s+/g, ' ').trim();
    const safeQuote = quoteNumber.replace(/[<>:"/\\|?*\n\r]/g, ' ').replace(/\s+/g, ' ').trim();

    const fileName = `${dateStr} - ${safeAddress} - ${safeContact} - Glass Flooring Systems Proposal #${safeQuote}.xlsx`;

    let createdDocId: string | null = null;
    try {
      createdDocId = await this._persistGeneratedProposal(projectId, userId, fileName, buffer, {
        quoteNumber,
        finalPrice: calculation.grandTotal,
      });
    } catch (err: any) {
      console.error(`[Proposal] Failed to persist generated Excel to Azure Storage for project ${projectId}:`, err?.message ?? err);
    }

    setImmediate(async () => {
      try {
        const project = await this.projectRepo.findById(projectId);
        if (project) {
          if (createdDocId) {
            await dropboxSyncService.uploadDirectDocument(
              project,
              createdDocId,
              fileName,
              DocumentTypeTag.QUOTE,
              buffer
            );
          } else {
            await dropboxSyncService.outwardSync(project);
          }
        } else {
          console.warn(`[Proposal] Could not find project ${projectId} for background Dropbox sync`);
        }
      } catch (err: any) {
        console.error(`[Proposal] Background Dropbox sync failed for project ${projectId}:`, err?.message ?? err);
      }
    });

    return { quoteNumber, fileName, buffer, nextSchema, createdDocId };
  }

  private async _persistGeneratedProposal(
    projectId: string,
    userId: string,
    fileName: string,
    buffer: Buffer,
    history?: { quoteNumber?: string | null; finalPrice?: number | null },
  ): Promise<string | null> {
    if (!this.blobStorage) {
      console.warn('[Proposal] blobStorage not configured — skipping generated proposal persistence');
      return null;
    }

    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

    const putResult = await this.blobStorage.put({
      projectId,
      sha256,
      originalName: fileName,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer,
    });

    // NOTE: intentionally NOT marking previous QUOTE documents as isLatest: false.
    // We keep full revision history — every generated proposal stays isLatest: true
    // and isActive: true so outwardSync's deletion-sync logic never removes an
    // older proposal from Dropbox.
    const docId = new mongoose.Types.ObjectId().toString();
    await DocumentModel.create({
      _id: docId,
      projectId: new mongoose.Types.ObjectId(projectId),
      rootDocumentId: docId,
      version: 1,
      isLatest: true,
      isActive: true,
      isFinalInput: false,
      documentType: DocumentTypeTag.QUOTE,
      status: 'PROCESSED',
      originalName: fileName,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      extension: '.xlsx',
      storageKey: putResult.storageKey,
      blobUrl: putResult.blobUrl,
      sha256,
      byteSize: buffer.length,
      uploadedBy: userId,
      uploadedAt: new Date(),
      processedAt: new Date(),
      metadata: {
        source: 'proposal-generator',
        engineVersion: PROPOSAL_ENGINE_VERSION,
        quoteNumber: history?.quoteNumber ?? null,
        finalPrice: history?.finalPrice ?? null,
      },
    });

    return docId;
  }

  async getFinalParametersSchema(projectId: string): Promise<any> {
    let schemaDoc = await this.proposalRepo.getCurrentSchema(projectId);
    if (!schemaDoc) {
      throw new AppError('Proposal not found', StatusCodes.NOT_FOUND);
    }

    if (!schemaDoc.stage_7?.cost_overrides || Object.keys(schemaDoc.stage_7.cost_overrides).length === 0) {
      try {
        await this.initializeStage7(projectId);
        const reloaded = await this.proposalRepo.getCurrentSchema(projectId);
        if (reloaded) {
          schemaDoc = reloaded;
        }
      } catch (err) {
        console.error(`[ProposalService] Failed to lazy-initialize Stage 7 in getFinalParametersSchema for ${projectId}:`, err);
      }
    }

    // The workbook formulas are represented by one backend calculation
    // contract. The frontend receives resolved quantities, amounts, and
    // totals so the live UI matches backend pricing 100%.
    const calculation = calculateFinalParameters(
      schemaDoc,
      schemaDoc.stage_7?.cost_overrides ?? {},
      schemaDoc.stage_7?.quantity_overrides ?? {},
    );

    return {
      categories: calculation.categories,
      subtotal: calculation.subtotal,
      total: calculation.total,
      finalPrice: calculation.finalPrice,
      alternateTotal: calculation.alternateTotal,
      optionalAddOnTotal: calculation.optionalAddOnTotal,
      grandTotal: calculation.grandTotal,
      quantity_overrides: schemaDoc.stage_7?.quantity_overrides || {},
      optionalAddOnStatuses: calculation.optionalAddOnStatuses,
      metrics: calculation.metrics,
    };
  }

  public computeProposalPrice(schema: IProjectSchema): number | null {
    if (!schema) return null;

    const costOverrides = schema.stage_7?.cost_overrides || {};
    const calculated = calculateFinalParameters(schema, costOverrides);

    // 1. Authoritative Graph snapshot if available and aligned with canonical contract
    const snapshotPrice = schema.stage_7?.computed_snapshot?.grand_total ?? schema.stage_7?.computed_snapshot?.final_price;
    if (
      typeof snapshotPrice === 'number' &&
      Number.isFinite(snapshotPrice) &&
      snapshotPrice > 0 &&
      (calculated.grandTotal <= 0 || Math.abs(snapshotPrice - calculated.grandTotal) <= 0.05)
    ) {
      return Math.round(snapshotPrice * 100) / 100;
    }

    // 2. Compute from the workbook-backed Final Parameters contract + stage 7
    // cost overrides. This keeps approval, live preview and retrigger flows on
    // the same formulas.
    return calculated.grandTotal > 0 ? calculated.grandTotal : null;
  }

  /**
   * The $50K approval threshold must be measured against the same number the
   * estimator sees as "Grand Total" on the Final Parameters page.
   * `computeProposalPrice` already returns that grand total (final price plus
   * any ACCEPTED optional add-ons — see `calculateFinalParameters`'s
   * `grandTotal`), so this is just a named alias for threshold call sites;
   * it must not re-add `alternateTotal` on top, which would both double-count
   * accepted add-ons and wrongly include ones that are only selected/pending.
   */
  private computeStage7ThresholdPrice(schema: IProjectSchema | null | undefined): number | null {
    if (!schema) return null;
    return this.computeProposalPrice(schema);
  }

  public async backfillAllProjectPrices(): Promise<{ updated: number; skipped: number }> {
    const projects = await this.projectRepo.listActive();
    let updated = 0;
    let skipped = 0;

    for (const project of projects) {
      try {
        const schema = await this.proposalRepo.getCurrentSchema(project.id);
        if (!schema) {
          skipped++;
          continue;
        }

        const price = this.computeProposalPrice(schema);
        const isStage7Approved =
          schema.pipeline_status?.stage_7_status === 'APPROVED' ||
          schema.stage_7?.status === 'APPROVED';

        const updatePayload: any = {};
        if (price && price > 0 && price !== project.estimatedCost) {
          updatePayload.estimatedCost = price;
        }
        if (isStage7Approved && project.status !== ProjectStatus.ADMIN_PACKAGING) {
          updatePayload.status = ProjectStatus.ADMIN_PACKAGING;
          updatePayload.analysisStatus = ProjectAnalysisStatus.COMPLETED;
        }

        if (Object.keys(updatePayload).length > 0) {
          await this.projectRepo.updateById(project.id, updatePayload);
          updated++;
        } else {
          skipped++;
        }
      } catch (err) {
        console.error(`[ProposalService] Error backfilling price/status for project ${project.id}:`, err);
        skipped++;
      }
    }

    return { updated, skipped };
  }

  async exportFeedbackCsv(projectId: string): Promise<string> {
    let project: IDomainProject | null = null;
    try {
      project = await this.projectRepo.findById(projectId);
    } catch (err: any) {
      if (
        err instanceof mongoose.Error.CastError ||
        err?.name === 'CastError' ||
        err?.name === 'BSONError'
      ) {
        throw new AppError('Project not found', StatusCodes.NOT_FOUND);
      }
      throw err;
    }

    if (!project) {
      throw new AppError('Project not found', StatusCodes.NOT_FOUND);
    }

    let schema: IProjectSchema | null = null;
    if (typeof this.proposalRepo.findByProjectId === 'function') {
      const proposal = await this.proposalRepo.findByProjectId(projectId);
      schema = proposal?.schema ?? null;
    } else if (typeof this.proposalRepo.getCurrentSchema === 'function') {
      try {
        schema = await this.proposalRepo.getCurrentSchema(projectId);
      } catch (err) {
        if (err instanceof AppError && err.statusCode === StatusCodes.NOT_FOUND) {
          schema = null;
        } else {
          throw err;
        }
      }
    }

    const rows = collectFeedbackRows(schema, {
      projectId: String(project.id ?? projectId),
      referenceNumber: project.referenceNumber ?? '',
      projectName: project.projectName ?? '',
    });

    return toCsv(rows);
  }

}

