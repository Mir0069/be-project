import { Schema, model, type InferSchemaType } from 'mongoose';

// Cached Microsoft Graph app-only (client-credentials) access token.
// Unlike Zoho there is no refresh token — when the cached token nears expiry
// the token service simply requests a new one with the client credentials.
const teamsTokenSchema = new Schema(
  {
    tokenKey: { type: String, required: true, unique: true, index: true },
    accessToken: { type: String, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

export type TeamsTokenDoc = InferSchemaType<typeof teamsTokenSchema>;

export const TeamsTokenModel = model('TeamsToken', teamsTokenSchema);
