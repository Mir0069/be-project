import { z } from 'zod';
import mongoose from 'mongoose';

import { FIELD_FEEDBACK_REASONS } from '@db/models/proposal.model';
import { aiStageResultBodySchema } from './multi-unit.contract';

export const objectIdSchema = z.string().refine((val) => mongoose.Types.ObjectId.isValid(val), {
  message: 'Invalid ObjectId format',
});

export const projectIdParamSchema = z.object({
  projectId: objectIdSchema,
});

export const assignStage7ApproverSchema = z.object({
  params: projectIdParamSchema,
  body: z.object({ approverId: objectIdSchema }),
});

export const stageParamSchema = z.object({
  stage: z.coerce.number().int().min(0).max(7),
});

// Optional beta capture: why the estimator overrode the AI's value.
export const fieldFeedbackSchema = z.object({
  reasonCode: z.enum(FIELD_FEEDBACK_REASONS),
  note: z.string().trim().max(500).optional(),
  changedColumns: z.array(z.string().min(1)).max(20).optional(),
});

export const fieldPatchSchema = z.object({
  fieldPath: z.string().min(1),
  value: z.unknown(),
  feedback: fieldFeedbackSchema.optional(),
});

export const runStageSchema = z.object({
  params: projectIdParamSchema.merge(stageParamSchema),
  body: z.any(),
});

export const patchFieldSchema = z.object({
  params: projectIdParamSchema,
  body: fieldPatchSchema,
});

export const patchStage7CostSchema = z.object({
  params: projectIdParamSchema,
  body: z.object({
    cell: z.string().min(2),
    cost: z.number().positive(),
    feedback: fieldFeedbackSchema.optional(),
  }),
});

export const patchStage7QuantitySchema = z.object({
  params: projectIdParamSchema,
  body: z.object({
    cell: z.string().min(2),
    quantity: z.number().min(0),
    feedback: fieldFeedbackSchema.optional(),
  }),
});

export const patchStage7ChargeSelectionSchema = z.object({
  params: projectIdParamSchema,
  body: z.object({
    cell: z.enum(['C69', 'C75', 'C76', 'C77', 'C78', 'C79', 'C80', 'C81', 'C82', 'C85', 'C89', 'C91', 'C93', 'C94']),
    selection: z.enum(['Y', 'N']),
    feedback: fieldFeedbackSchema.optional(),
  }),
});

export const saveStageFieldsSchema = z.object({
  params: projectIdParamSchema.merge(stageParamSchema),
  body: z.object({ fields: z.array(fieldPatchSchema) }),
});

export const unapproveStageSchema = z.object({
  params: projectIdParamSchema.merge(stageParamSchema),
  body: z.object({
    reason: z.string().trim().max(500).optional(),
  }),
});

export const getVersionSchema = z.object({
  params: projectIdParamSchema.merge(z.object({
    version: z.coerce.number().int().min(0),
  })),
});

export const aiStageResultWebhookSchema = z.object({
  params: projectIdParamSchema,
  body: aiStageResultBodySchema,
});

export const patchStage7OptionalAddOnStatusSchema = z.object({
  params: projectIdParamSchema,
  body: z.object({
    cell: z.enum(['C107', 'C109', 'C110']),
    status: z.enum(['NOT_SELECTED', 'SELECTED_PENDING_ACCEPTANCE', 'ACCEPTED', 'DECLINED']),
  }),
});

export const patchProposalCellsSchema = z.object({
  params: projectIdParamSchema,
  body: z.object({
    target_sheet: z.string().min(1).optional(),
    cells: z.record(z.string(), z.unknown()),
  }),
});

export const proposalDocumentParamsSchema = z.object({
  params: projectIdParamSchema.merge(z.object({
    documentId: objectIdSchema,
  })),
});
