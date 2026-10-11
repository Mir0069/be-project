import {
  auditCategoryForAction,
  FULL_AUDIT_LOG_ROLES,
  isBasicAuditAction,
} from '@features/audit-logs/audit-logs.service';
import { AuditLogCategory } from '@features/audit-logs/audit-logs.types';
import { UserRole } from '@db/models/user.model';

describe('audit log policy helpers', () => {
  it('classifies processing events as estimator-visible basic history', () => {
    expect(isBasicAuditAction('document.uploaded')).toBe(true);
    expect(isBasicAuditAction('extraction.completed')).toBe(true);
    expect(isBasicAuditAction('document.delete')).toBe(false);
    expect(isBasicAuditAction('api.patch.project-workspace.status')).toBe(true);
  });

  it('maps event names to their audit category', () => {
    expect(auditCategoryForAction('user.role.changed')).toBe(AuditLogCategory.USER);
    expect(auditCategoryForAction('proposal.stage.approved')).toBe(AuditLogCategory.APPROVAL);
    expect(auditCategoryForAction('document.uploaded')).toBe(AuditLogCategory.DOCUMENT);
    expect(auditCategoryForAction('api.patch.project-workspace.status')).toBe(AuditLogCategory.PROJECT);
  });

  it('gives full audit visibility to the agreed elevated roles', () => {
    expect(FULL_AUDIT_LOG_ROLES).toEqual([
      UserRole.SALES_MANAGER,
      UserRole.SYSTEM_ADMIN,
      UserRole.SUPER_ADMIN,
    ]);
  });
});
