import { Project } from '@db/models/project.model';
import { hasAnyRole } from '@shared/security/role-access';
import { DocumentIngestionError } from './document-ingestion.service';
import { AuthContext, DocumentRecord, PermissionService } from './document-ingestion.types';

export class RoleBasedPermissionService implements PermissionService {
  
  private isElevatedUser(ctx: AuthContext): boolean {
    const roles = (ctx.roles || []).map((r) => String(r).toUpperCase());
    return roles.some((role) => hasAnyRole(role, ['SYSTEM_ADMIN', 'SALES_MANAGER', 'SUPER_ADMIN']));
  }

  private async isProjectEstimator(ctx: AuthContext, projectId: string | null): Promise<boolean> {
    const roles = (ctx.roles || []).map((r) => String(r).toUpperCase());
    if (!roles.includes('ESTIMATOR')) return false;

    if (!projectId) return false;

    const project = await Project.findById(projectId).select('assignedEstimator assignedEstimators').exec() as any;
    if (!project) throw new DocumentIngestionError('Project not found', 404);

    const matchSingular = project.assignedEstimator && String(project.assignedEstimator) === String(ctx.userId);
    const matchArray = Array.isArray(project.assignedEstimators) && project.assignedEstimators.some((estimator: any) => {
      const estimatorId = estimator && typeof estimator === 'object'
        ? estimator._id ?? estimator.id
        : estimator;
      return String(estimatorId) === String(ctx.userId);
    });

    return Boolean(matchSingular || matchArray);
  }

  public async assertCanUpload(ctx: AuthContext, projectId: string | null): Promise<void> {
    if (this.isElevatedUser(ctx)) return;
    
    const isEstimator = await this.isProjectEstimator(ctx, projectId);
    if (!isEstimator) {
      throw new DocumentIngestionError('Only System Admins, Sales Managers, or the assigned Project Estimator can upload documents.', 403);
    }
  }

  public async assertCanDelete(ctx: AuthContext, document: DocumentRecord): Promise<void> {
    if (this.isElevatedUser(ctx)) return;

    const isAssignedEstimator = await this.isProjectEstimator(ctx, document.projectId);
    if (!isAssignedEstimator) {
      throw new DocumentIngestionError('Only an assigned Project Estimator can delete documents for this project.', 403);
    }
  }

  public async assertCanUpdate(ctx: AuthContext, document: DocumentRecord): Promise<void> {
    if (this.isElevatedUser(ctx)) return;

    const isEstimator = await this.isProjectEstimator(ctx, document.projectId);
    if (!isEstimator) {
      throw new DocumentIngestionError('You do not have permission to modify documents for this project.', 403);
    }
  }

  public async assertCanDownload(ctx: AuthContext, _document: DocumentRecord): Promise<void> {
    // All authenticated users in the organization (system admins, sales managers, estimators, team members) have read permission to view/download project documents
    if (this.isElevatedUser(ctx)) return;
    if (ctx.userId) return;

    throw new DocumentIngestionError('Authentication required to view or download documents.', 401);
  }
}
