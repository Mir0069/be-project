// =============================================================================
// PROPOSAL REPOSITORY — INTERFACE
// =============================================================================

import type { IProjectSchema, IProjectVersion, IProposalDoc, WorkflowStage } from '@db/models/proposal.model';

export interface IAppendVersionFields {
  readonly projectId: string;
  readonly nextSchema: IProjectSchema;
  readonly changedFieldPaths: string[];
  readonly source: 'AI' | 'ESTIMATOR';
  readonly updatedBy: string;
  readonly stage: WorkflowStage | 0;
  readonly approvalStatus?: 'PENDING' | 'APPROVED';
  readonly versionKey?: string; // NEW
}

export interface IExcelGenerationLogFields {
  readonly projectId: string;
  readonly generatedBy: string;
  readonly fileId?: string;
}

export interface IAppendRevisionFields {
  readonly projectId: string;
  readonly stage: WorkflowStage | 0;
  readonly reason: string;
  readonly revisedBy: string;
}

export interface IProposalRepository {
  /**
   * Retrieves the full Proposal document by projectId.
   */
  findByProjectId(projectId: string): Promise<IProposalDoc | null>;

  /**
   * Creates a new Proposal document for a project if it doesn't exist,
   * seeded with a fully null-valued unified schema.
   */
  ensureProposalExists(projectId: string): Promise<IProposalDoc>;

  /**
   * Retrieves the current schema state for a project.
   */
  getCurrentSchema(projectId: string): Promise<IProjectSchema>;

  /**
   * Appends a new immutable version to the versions array.
   * This updates the current schema representation and pushes the version metadata.
   */
  appendVersion(fields: IAppendVersionFields): Promise<IProposalDoc>;

  /**
   * Gets the full version history for the project.
   */
  getVersionHistory(projectId: string): Promise<IProjectVersion[]>;

  /**
   * Retrieves a specific version from history.
   */
  getVersion(projectId: string, versionNumber: number): Promise<IProjectVersion | null>;

  /**
   * Logs an Excel generation event.
   */
  logExcelGeneration(fields: IExcelGenerationLogFields): Promise<void>;

  /**
   * Appends a new revision record for a stage.
   * Revision numbers increment per stage (1-based).
   */
  appendRevision(fields: IAppendRevisionFields): Promise<IProposalDoc>;
}
