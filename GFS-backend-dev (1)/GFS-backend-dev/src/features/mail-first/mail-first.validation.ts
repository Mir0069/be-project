import { z } from 'zod';

export const draftIdSchema = z.object({
  params: z.object({
    emailId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'emailId must be a valid id'),
  }),
});

export const updateDraftSchema = z.object({
  params: z.object({
    emailId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'emailId must be a valid id'),
  }),
  body: z.object({
    projectName: z.string().trim().min(1, 'projectName is required'),
  }),
});

// Preview one attachment of a draft. The storageKey is the opaque key handed out
// by GET /drafts; the service verifies it belongs to this draft before streaming.
export const previewAttachmentSchema = z.object({
  params: z.object({
    emailId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'emailId must be a valid id'),
  }),
  body: z.object({
    storageKey: z.string().trim().min(1, 'storageKey is required'),
  }),
});

export const linkDraftSchema = z.object({
  params: z.object({
    emailId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'emailId must be a valid id'),
  }),
  body: z.object({
    projectId: z.string().trim().min(1, 'projectId is required'),
  }),
});
