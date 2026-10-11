import { z } from 'zod';

export const listChannelsSchema = z.object({
  params: z.object({
    teamId: z.string().min(1, 'required'),
  }),
});

export const addMonitoredChannelSchema = z.object({
  body: z.object({
    teamId: z.string().min(1, 'required'),
    teamName: z.string().min(1, 'required'),
    channelId: z.string().min(1, 'required'),
    channelName: z.string().min(1, 'required'),
    projectId: z.string().min(1).optional(),
    // Opt in to sharing a channel already linked to another project.
    force: z.boolean().optional(),
  }),
});

export const provisioningProjectSchema = z.object({
  params: z.object({
    projectId: z.string().min(1, 'required'),
  }),
});

// Same fields as addMonitoredChannelSchema minus projectId, which is in the path.
export const connectProvisioningCandidateSchema = z.object({
  params: z.object({
    projectId: z.string().min(1, 'required'),
  }),
  body: z.object({
    teamId: z.string().min(1, 'required'),
    teamName: z.string().min(1, 'required'),
    channelId: z.string().min(1, 'required'),
    channelName: z.string().min(1, 'required'),
    force: z.boolean().optional(),
  }),
});

export const removeMonitoredChannelSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'required'),
  }),
  query: z.object({
    // Unlink only this project from a shared channel.
    projectId: z.string().optional(),
  }),
});

export const syncSchema = z.object({
  body: z
    .object({
      channelDbId: z.string().min(1).optional(),
    })
    .optional(),
});

export const listMessagesSchema = z.object({
  query: z.object({
    projectId: z.string().optional(),
    channelId: z.string().optional(),
    page: z.string().optional(),
    limit: z.string().optional(),
  }),
});

export const linkMessageSchema = z.object({
  params: z.object({
    messageId: z.string().min(1, 'required'),
  }),
  body: z.object({
    projectId: z.string().min(1, 'required'),
  }),
});

export const processFilesSchema = z.object({
  params: z.object({
    messageId: z.string().min(1, 'required'),
  }),
});

export const fetchTranscriptsSchema = z.object({
  body: z.object({
    userId: z.string().min(1, 'required'),
    meetingId: z.string().min(1, 'required'),
    projectId: z.string().min(1).optional(),
  }),
});

export const listTranscriptsSchema = z.object({
  query: z.object({
    projectId: z.string().optional(),
    meetingId: z.string().optional(),
    page: z.string().optional(),
    limit: z.string().optional(),
  }),
});

export const linkTranscriptSchema = z.object({
  params: z.object({
    transcriptId: z.string().min(1, 'required'),
  }),
  body: z.object({
    projectId: z.string().min(1, 'required'),
  }),
});

export const listMeetingsSchema = z.object({
  query: z.object({
    projectId: z.string().optional(),
    channelId: z.string().optional(),
    page: z.string().optional(),
    limit: z.string().optional(),
  }),
});

export const getMeetingSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'required'),
  }),
});

export const projectAiSummarySchema = z.object({
  params: z.object({
    projectId: z.string().min(1, 'required'),
  }),
});

// AI → backend callback (POST /teams/ai-result). One result per summary:
// target 'chat' (the channel's chat summary) or 'meeting' (+ meetingId).
export const teamsAiResultSchema = z.object({
  body: z.object({
    correlationId: z.string().min(1, 'required'),
    projectId: z.string().optional(),
    readinessState: z.string().optional(),
    results: z
      .array(
        z.object({
          target: z.enum(['chat', 'meeting']),
          meetingId: z.string().optional(),
          summary: z.string().default(''),
          keyPoints: z.array(z.string()).optional(),
          requirements: z.array(z.string()).optional(),
          confidence: z.number().optional(),
        }),
      )
      .default([]),
    timing: z.any().optional(),
  }),
});
