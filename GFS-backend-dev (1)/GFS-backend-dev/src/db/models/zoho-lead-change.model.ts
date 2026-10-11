import mongoose, { Document, Schema } from 'mongoose';


export type ZohoLeadChangeType = 'CREATED' | 'UPDATED';
export type ZohoLeadChangeSource = 'backfill' | 'webhook' | 'poll';

export interface IZohoLeadChange extends Document {
  zohoLeadId: string;
  leadName?: string | null;
  type: ZohoLeadChangeType;
  field?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
  changedAt: Date;
  source: ZohoLeadChangeSource;
  createdAt: Date;
  updatedAt: Date;
}

const ZohoLeadChangeSchema = new Schema<IZohoLeadChange>(
  {
    zohoLeadId: { type: String, required: true },
    leadName: { type: String, default: null },
    type: { type: String, enum: ['CREATED', 'UPDATED'], required: true },
    field: { type: String, default: null },
    oldValue: { type: String, default: null },
    newValue: { type: String, default: null },
    changedAt: { type: Date, required: true },
    source: { type: String, enum: ['backfill', 'webhook', 'poll'], required: true },
  },
  { timestamps: true },
);


ZohoLeadChangeSchema.index({ changedAt: -1 });
ZohoLeadChangeSchema.index({ zohoLeadId: 1, changedAt: -1 });

export const ZohoLeadChange = mongoose.model<IZohoLeadChange>(
  'ZohoLeadChange',
  ZohoLeadChangeSchema,
);
