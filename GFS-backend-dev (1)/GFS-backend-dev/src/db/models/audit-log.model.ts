import mongoose, { Document, Schema } from 'mongoose';
import {
  AuditLogCategory,
  AuditLogSource,
  AuditLogVisibility,
} from '@features/audit-logs/audit-logs.types';
import { UserRole } from './user.model';

export interface IAuditLog extends Document {
  action: string;
  category: AuditLogCategory;
  visibility: AuditLogVisibility;
  actorId: string;
  actorRole?: UserRole | null;
  actorEmail?: string | null;
  projectId?: string | null;
  divisionId?: string | null;
  targetType: string;
  targetId?: string | null;
  targetLabel?: string | null;
  description: string;
  metadata?: Record<string, unknown>;
  before?: unknown;
  after?: unknown;
  source: AuditLogSource;
  requestId?: string | null;
  createdAt: Date;
}

const AuditLogSchema = new Schema<IAuditLog>({
  action: { type: String, required: true, index: true },
  category: { type: String, enum: Object.values(AuditLogCategory), required: true, index: true },
  visibility: { type: String, enum: Object.values(AuditLogVisibility), required: true, index: true },
  // System and AI events use stable non-user actor IDs, so this stays a string.
  actorId: { type: String, required: true, index: true },
  actorRole: { type: String, enum: Object.values(UserRole), default: null },
  actorEmail: { type: String, default: null },
  projectId: { type: String, default: null, index: true },
  // Reserved for the future Head of Division scope. It remains optional until
  // the division entity and project-ownership migration are approved.
  divisionId: { type: String, default: null, index: true },
  targetType: { type: String, required: true },
  targetId: { type: String, default: null },
  targetLabel: { type: String, default: null },
  description: { type: String, required: true },
  metadata: { type: Schema.Types.Mixed, default: undefined },
  before: { type: Schema.Types.Mixed, default: undefined },
  after: { type: Schema.Types.Mixed, default: undefined },
  source: { type: String, enum: Object.values(AuditLogSource), required: true },
  requestId: { type: String, default: null },
  createdAt: { type: Date, required: true, default: Date.now, immutable: true },
});

AuditLogSchema.index({ projectId: 1, createdAt: -1 });
AuditLogSchema.index({ createdAt: -1, _id: -1 });

export const AuditLog = mongoose.model<IAuditLog>('AuditLog', AuditLogSchema);
