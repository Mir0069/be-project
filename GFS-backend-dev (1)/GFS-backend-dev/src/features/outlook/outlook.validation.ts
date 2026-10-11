import { z } from 'zod';

export const listMailUsersSchema = z.object({
  query: z.object({
    search: z.string().optional(),
  }),
});

export const listMailFoldersSchema = z.object({
  params: z.object({
    userId: z.string().min(1, 'required'),
  }),
});

export const addMonitoredMailboxSchema = z.object({
  body: z.object({
    userId: z.string().min(1, 'required'),
    displayName: z.string().min(1, 'required'),
    folderId: z.string().min(1).optional(),
    projectId: z.string().min(1).optional(),
  }),
});

export const removeMonitoredMailboxSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'required'),
  }),
});

export const syncSchema = z.object({
  body: z
    .object({
      mailboxDbId: z.string().min(1).optional(),
    })
    .optional(),
});

export const listEmailsSchema = z.object({
  query: z.object({
    projectId: z.string().optional(),
    mailboxUserId: z.string().optional(),
    conversationId: z.string().optional(),
    page: z.string().optional(),
    limit: z.string().optional(),
  }),
});

export const linkEmailSchema = z.object({
  params: z.object({
    messageId: z.string().min(1, 'required'),
  }),
  body: z.object({
    projectId: z.string().min(1, 'required'),
  }),
});

export const aiResultSchema = z.object({
  body: z.object({
    correlationId: z.string().min(1, 'required'),
    action: z.enum(['CREATE', 'LINK', 'DISCARD']),
    readinessState: z.string().optional(),
    proposed: z.object({
      isProject: z.boolean().optional(),
      customerName: z.string().optional().nullable(),
      projectName: z.string().optional().nullable(),
      projectType: z.string().optional().nullable(),
      summary: z.string().optional().nullable(),
      confidence: z.number().optional(),
      reasoning: z.string().optional().nullable(),

      address: z.string().optional().nullable(),
      jobAddress: z.string().optional().nullable(),
      companyName: z.string().optional().nullable(),
      company: z.string().optional().nullable(),
      groupId: z.string().min(1).optional().nullable(),
      isCompetitiveBid: z.boolean().optional(),
      allBidders: z.array(z.object({
        email: z.string().email().optional(),
        company: z.string().optional(),
        isPrimary: z.boolean().optional(),
      })).optional().nullable(),
      primaryBidderEmail: z.string().email().optional().nullable(),
      allAddresses: z.array(z.object({
        address: z.string().min(1),
        type: z.enum(['INSTALLATION', 'BILLING', 'UNKNOWN']),
      })).optional().nullable(),
    }).optional(),
    projectId: z.string().optional(),
    timing: z.any().optional()
  }),
});

export const moveEmailSchema = z.object({
  params: z.object({
    emailId: z.string().min(1, 'required'),
  }),
  body: z.object({
    targetProjectId: z.string().min(1, 'required'),
    runExtraction: z.boolean().optional(),
  }),
});

