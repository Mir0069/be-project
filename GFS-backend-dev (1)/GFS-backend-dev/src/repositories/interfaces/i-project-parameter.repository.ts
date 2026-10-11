import type mongoose from 'mongoose';
import type { 
  AIStageStatus, 
  AIFieldStatus, 
  AIConfidence 
} from '@db/models/project-parameter.model';

export interface IDomainAIField {
  cell: string;
  label: string;
  value: any;
  confidence: AIConfidence;
  reference: string | null;
  status: AIFieldStatus;
  stage: number;
}

export interface ICreateProjectParameterFields {
  projectId: mongoose.Types.ObjectId | string;
  stages?: {
    stage_1?: { status?: AIStageStatus; fields?: IDomainAIField[] };
    stage_2?: { status?: AIStageStatus; fields?: IDomainAIField[] };
    stage_3?: { status?: AIStageStatus; fields?: IDomainAIField[] };
    stage_4?: { status?: AIStageStatus; cell_writes?: any[] };
  };
}

export interface IUpdateProjectParameterFields {
  stages?: {
    stage_1?: { status?: AIStageStatus; fields?: IDomainAIField[] };
    stage_2?: { status?: AIStageStatus; fields?: IDomainAIField[] };
    stage_3?: { status?: AIStageStatus; fields?: IDomainAIField[] };
    stage_4?: { status?: AIStageStatus; cell_writes?: any[] };
  };
}

export interface IDomainProjectParameter {
  id: string;
  projectId: string;
  stages: {
    stage_1: { status: AIStageStatus; fields: IDomainAIField[] };
    stage_2: { status: AIStageStatus; fields: IDomainAIField[] };
    stage_3: { status: AIStageStatus; fields: IDomainAIField[] };
    stage_4: { status: AIStageStatus; cell_writes: any[] };
  };
  createdAt: Date;
  updatedAt: Date;
}

export interface IProjectParameterRepository {
  findByProjectId(projectId: string): Promise<IDomainProjectParameter | null>;
  create(fields: ICreateProjectParameterFields): Promise<IDomainProjectParameter>;

  /**
   * Create-or-return for a project's parameter row, idempotent on projectId.
   * `create` throws duplicate-key when a row already exists, which turns a
   * harmless retry into a failed provision; this cannot.
   */
  ensureForProject(projectId: string): Promise<IDomainProjectParameter>;
  updateByProjectId(projectId: string, fields: IUpdateProjectParameterFields): Promise<IDomainProjectParameter | null>;
}