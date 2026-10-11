import { Schema, model, type InferSchemaType } from 'mongoose';

// Cached Microsoft Graph app-only (client-credentials) access token for the
// Outlook mail integration. Same model shape as TeamsToken but stored
// separately so the two integrations can use different app registrations.
const outlookTokenSchema = new Schema(
  {
    tokenKey: { type: String, required: true, unique: true, index: true },
    accessToken: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    refreshToken: { type: String, default: null },
    accountType: { type: String, enum: ['delegated', 'app_only'], default: 'app_only' },
  },
  { timestamps: true },
);

export type OutlookTokenDoc = InferSchemaType<typeof outlookTokenSchema>;

export const OutlookTokenModel = model('OutlookToken', outlookTokenSchema);
