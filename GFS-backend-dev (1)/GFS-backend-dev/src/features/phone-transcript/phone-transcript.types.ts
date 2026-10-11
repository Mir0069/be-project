import { z } from 'zod';

export const CreateCallRecordSchema = z.object({
  body: z
    .object({
      callDate: z.coerce.date(),
      customerName: z.string().trim().min(1, 'Customer name is required'),
      summaryText: z.string().trim().min(1).optional(),
      transcriptFileUrl: z.string().url('Invalid transcript file URL').optional(),
      transcriptFileName: z.string().trim().min(1).optional(),
    })
    .refine(
      (data) => data.summaryText !== undefined || data.transcriptFileUrl !== undefined,
      { message: 'Either summaryText or transcriptFileUrl must be provided' },
    ),
});

export const UpdateCallRecordSchema = z.object({
  body: z
    .object({
      callDate: z.coerce.date().optional(),
      customerName: z.string().trim().min(1).optional(),
      summaryText: z.string().trim().min(1).optional(),
      transcriptFileUrl: z.string().url('Invalid transcript file URL').optional(),
      transcriptFileName: z.string().trim().min(1).optional(),
    })
    .refine(
      (data) => Object.values(data).some((v) => v !== undefined),
      { message: 'At least one field must be provided' },
    ),
});

export const ListCallRecordsQuerySchema = z.object({
  query: z.object({
    page: z.coerce.number().int().positive().optional().default(1),
    limit: z.coerce.number().int().positive().max(100).optional().default(12),
  }),
});

export type CreateCallRecordBody = z.infer<typeof CreateCallRecordSchema>['body'];
export type UpdateCallRecordBody = z.infer<typeof UpdateCallRecordSchema>['body'];
export type ListCallRecordsQuery = z.infer<typeof ListCallRecordsQuerySchema>['query'];
