import { z } from 'zod';
import { AuditLogCategory } from './audit-logs.types';

export const listAuditLogsSchema = z.object({
  query: z.object({
    since: z.string().datetime().optional(),
    actorEmail: z.string().trim().email().max(254).optional(),
    projectId: z.string().trim().min(1).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    action: z.string().trim().min(1).max(200).optional(),
    category: z.enum(Object.values(AuditLogCategory) as [string, ...string[]]).optional(),
  }),
});
