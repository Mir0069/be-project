import { env } from '@config/index';
import { hasAnyRole } from '@shared/security/role-access';
import { UserRole } from '@db/models/user.model';

export interface ApprovalCandidate {
  role: string | null | undefined;
  email: string;
  isActive: boolean;
}

export interface ApprovalThresholdConfig {
  highValueThreshold: number;
  highValueApproverEmails: string[];
}

/**
 * Whether `user` may approve Stage 7 for a proposal priced at `finalPrice`.
 * Any active Sales Manager (or Head of Division, which inherits the role)
 * qualifies at or below the threshold; above it, only the configured
 * named accounts do.
 */
export function isEligibleApprover(
  user: ApprovalCandidate,
  finalPrice: number | null | undefined,
  cfg: ApprovalThresholdConfig = env.proposalApproval,
): boolean {
  if (!user.isActive) return false;
  if (!hasAnyRole(user.role, [UserRole.SALES_MANAGER])) return false;

  const isHighValue = typeof finalPrice === 'number' && Number.isFinite(finalPrice) && finalPrice > cfg.highValueThreshold;
  if (!isHighValue) return true;

  return cfg.highValueApproverEmails.includes(user.email.trim().toLowerCase());
}
