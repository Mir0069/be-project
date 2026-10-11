import { z } from 'zod';

export const zohoCallbackSchema = z.object({
  query: z.object({
    code: z.string().min(1, 'required'),
    location: z.string().optional(),
    'accounts-server': z.string().url().optional(),
    state: z.string().optional(),
  }),
});

export const zohoFetchSchema = z.object({
  params: z.object({
    module: z.string().min(1, 'required'),
  }),
  query: z.object({
    page: z.string().optional(),
    per_page: z.string().optional(),
    fields: z.string().optional(),
  }),
});

export const zohoInsertSchema = z.object({
  params: z.object({
    module: z.string().min(1, 'required'),
  }),
  body: z.object({
    data: z.array(z.record(z.string(), z.unknown())).min(1, 'at least one record required'),
    trigger: z.array(z.string()).optional(),
  }),
});
