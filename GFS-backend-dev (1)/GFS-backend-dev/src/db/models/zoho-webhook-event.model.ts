import mongoose, { Document, Schema } from 'mongoose';

/**
 * Raw capture of every inbound Zoho webhook call.
 *
 * This is a diagnostic/testing collection: we persist exactly what Zoho sends
 * (body + selected headers) so we can inspect the real payload shape before
 * writing any parsing/mapping logic. Read-only with respect to Zoho — nothing
 * here ever calls back out to their CRM.
 */
export interface IZohoWebhookEvent extends Document {
  method: string;
  query: Record<string, unknown>;
  headers: Record<string, unknown>;
  body: unknown;
  receivedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ZohoWebhookEventSchema = new Schema<IZohoWebhookEvent>(
  {
    method: { type: String, required: true },
    query: { type: Schema.Types.Mixed, default: {} },
    headers: { type: Schema.Types.Mixed, default: {} },
    body: { type: Schema.Types.Mixed, default: null },
    receivedAt: { type: Date, required: true },
  },
  { timestamps: true },
);

ZohoWebhookEventSchema.index({ receivedAt: -1 });

export const ZohoWebhookEvent = mongoose.model<IZohoWebhookEvent>(
  'ZohoWebhookEvent',
  ZohoWebhookEventSchema,
);
