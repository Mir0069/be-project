import type { HydratedDocument } from 'mongoose';
import { ProjectParameter, type IProjectParameter } from '@db/models/project-parameter.model';
import type {
  IProjectParameterRepository,
  ICreateProjectParameterFields,
  IUpdateProjectParameterFields,
  IDomainProjectParameter,
} from '@repositories/interfaces/i-project-parameter.repository';

export class MongooseProjectParameterRepository implements IProjectParameterRepository {
  
  public async findByProjectId(projectId: string): Promise<IDomainProjectParameter | null> {
    const params = await ProjectParameter.findOne({ projectId });
    return params ? this.toDomain(params) : null;
  }

  public async create(fields: ICreateProjectParameterFields): Promise<IDomainProjectParameter> {
    const params = await ProjectParameter.create(fields);
    return this.toDomain(params);
  }

  /** See IProjectParameterRepository.ensureForProject. Idempotent on projectId. */
  public async ensureForProject(projectId: string): Promise<IDomainProjectParameter> {
    const params = await ProjectParameter.findOneAndUpdate(
      { projectId },
      { $setOnInsert: { projectId } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
    return this.toDomain(params);
  }

  public async updateByProjectId(projectId: string, fields: IUpdateProjectParameterFields): Promise<IDomainProjectParameter | null> {
    const params = await ProjectParameter.findOneAndUpdate(
      { projectId }, 
      { $set: fields }, 
      { new: true }
    );
    return params ? this.toDomain(params) : null;
  }

  private toDomain(params: HydratedDocument<IProjectParameter>): IDomainProjectParameter {
    return {
      id: params._id.toString(),
      projectId: params.projectId.toString(),
      stages: {
        stage_1: {
          status: params.stages.stage_1.status,
          fields: params.stages.stage_1.fields || [],
        },
        stage_2: {
          status: params.stages.stage_2.status,
          fields: params.stages.stage_2.fields || [],
        },
        stage_3: {
          status: params.stages.stage_3.status,
          fields: params.stages.stage_3.fields || [],
        },
        stage_4: {
          status: params.stages.stage_4.status,
          cell_writes: params.stages.stage_4.cell_writes || [],
        }
      },
      createdAt: params.createdAt,
      updatedAt: params.updatedAt,
    };
  }
}