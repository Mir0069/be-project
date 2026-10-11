import mongoose, { Document, Schema } from 'mongoose';

// A Microsoft Graph change-notification subscription for one monitored channel's
// messages. Graph caps channel-message subscriptions near 60 minutes, so these
// are renewed on a 5-minute cron well before expiry.
export interface ITeamsSubscription extends Document {
  subscriptionId: string;
  monitoredChannelDbId: mongoose.Types.ObjectId;
  teamId: string;
  channelId: string;
  resource: string;
  changeType: string;
  notificationUrl: string;
  clientState: string;
  expirationDateTime: Date;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const TeamsSubscriptionSchema = new Schema<ITeamsSubscription>(
  {
    subscriptionId: { type: String, required: true, unique: true },
    monitoredChannelDbId: {
      type: Schema.Types.ObjectId,
      ref: 'TeamsMonitoredChannel',
      required: true,
    },
    teamId: { type: String, required: true },
    channelId: { type: String, required: true },
    resource: { type: String, required: true },
    changeType: { type: String, required: true },
    notificationUrl: { type: String, required: true },
    clientState: { type: String, required: true },
    expirationDateTime: { type: Date, required: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

TeamsSubscriptionSchema.index({ monitoredChannelDbId: 1 });
TeamsSubscriptionSchema.index({ isActive: 1, expirationDateTime: 1 });

export const TeamsSubscription = mongoose.model<ITeamsSubscription>(
  'TeamsSubscription',
  TeamsSubscriptionSchema,
);
