import { Schema, model, type InferSchemaType } from 'mongoose';

const zohoTokenSchema = new Schema(
  {
    accountKey: { type: String, required: true, unique: true, index: true },
    accessToken: { type: String, required: true },
    refreshToken: { type: String, required: true },
    apiDomain: { type: String, required: true },
    scope: { type: String },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

export type ZohoTokenDoc = InferSchemaType<typeof zohoTokenSchema>;

export const ZohoTokenModel = model('ZohoToken', zohoTokenSchema);
