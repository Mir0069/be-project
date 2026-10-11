import type { AuditLogger } from '@features/document-ingestion/document-ingestion.types';
import { auditCategoryForAction, auditLogService, isBasicAuditAction } from './audit-logs.service';
import { AuditLogSource, AuditLogVisibility } from './audit-logs.types';

/** Adapter for the document pipeline's existing audit events. */
export class PersistentAuditLogger implements AuditLogger {
  public async log(event: {
    action: string;
    actorId: string;
    projectId?: string | null;
    documentId?: string;
    details?: Record<string, unknown>;
  }): Promise<void> {
    const targetType = event.documentId ? 'DOCUMENT' : event.projectId ? 'PROJECT' : 'SYSTEM';
    const targetId = event.documentId ?? event.projectId ?? null;
    await auditLogService.recordBestEffort({
      action: event.action,
      category: auditCategoryForAction(event.action),
      visibility: isBasicAuditAction(event.action) ? AuditLogVisibility.BASIC : AuditLogVisibility.FULL,
      actorId: event.actorId,
      projectId: event.projectId ?? null,
      targetType,
      targetId,
      description: event.action.replace(/[._]/g, ' '),
      metadata: event.details,
      source: event.actorId === 'system' ? AuditLogSource.SYSTEM : AuditLogSource.API,
    });
  }
}

export const persistentAuditLogger = new PersistentAuditLogger();
