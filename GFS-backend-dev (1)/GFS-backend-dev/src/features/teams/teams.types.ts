// ----- Microsoft Graph wire DTOs (subset of fields we use) -----

export interface GraphTokenResponse {
  token_type: string;
  expires_in: number;
  access_token: string;
}

export interface GraphList<T> {
  value: T[];
  '@odata.nextLink'?: string;
  '@odata.deltaLink'?: string;
}

export interface GraphTeam {
  id: string;
  displayName: string;
  description?: string;
}

export interface GraphChannel {
  id: string;
  displayName: string;
  description?: string;
  webUrl?: string;
}

export interface GraphIdentity {
  user?: { id?: string; displayName?: string } | null;
}

export interface GraphMessageBody {
  contentType?: string;
  content?: string;
}

export interface GraphAttachment {
  id: string;
  contentType?: string;
  contentUrl?: string;
  name?: string;
  // For contentType 'meetingReference', a JSON string:
  // { exchangeId, organizerId, meetingJoinUrl }.
  content?: string | null;
}

export interface GraphMeetingEventDetail {
  // Teams populates these on channel-event messages posted when a channel
  // meeting starts/ends. Real Graph responses use:
  //   - '@odata.type' = '#microsoft.graph.callStartedEventMessageDetail' for
  //     meeting-start events (also '...callEndedEventMessageDetail' for end).
  //   - 'initiator.user.id' as the organizer/initiator of the meeting.
  //   - 'callId' as the only stable identifier (meetingId is NOT in the event
  //     payload for channel meetings — must be resolved via
  //     getAllTranscriptsByOrganizer).
  '@odata.type'?: string;
  callId?: string;
  callEventType?: string;
  initiator?: GraphIdentity | null;
  // Older docs reference these — kept optional for forward/backward compat.
  meetingId?: string;
  meetingOrganizer?: GraphIdentity | null;
  // Any other keys we don't care about right now.
  [key: string]: unknown;
}

export const CALL_STARTED_EVENT_ODATA_TYPE =
  '#microsoft.graph.callStartedEventMessageDetail';

export interface GraphChannelMessage {
  id: string;
  replyToId?: string | null;
  messageType?: string;
  createdDateTime?: string;
  deletedDateTime?: string | null;
  webUrl?: string;
  from?: GraphIdentity | null;
  body?: GraphMessageBody;
  attachments?: GraphAttachment[];
  eventDetail?: GraphMeetingEventDetail | null;
}

// Single entry in the response of
// /users/{id}/onlineMeetings/getAllTranscripts(meetingOrganizerUserId='{id}')
export interface GraphTranscriptListEntry {
  id: string;
  meetingId?: string;
  meetingOrganizerId?: string;
  createdDateTime?: string;
  transcriptContentUrl?: string;
}

export interface GraphDriveItem {
  id: string;
  name?: string;
  size?: number;
  file?: { mimeType?: string };
  webUrl?: string;
  folder?: { childCount?: number };
  parentReference?: { driveId?: string };
  '@microsoft.graph.downloadUrl'?: string;
}

export interface GraphOnlineMeeting {
  id: string;
  subject?: string | null;
  joinWebUrl?: string;
  startDateTime?: string;
  endDateTime?: string;
  organizer?: GraphIdentity | null;
}

export interface GraphCallTranscript {
  id: string;
  createdDateTime?: string;
  meetingId?: string;
  transcriptContentUrl?: string;
}

export interface GraphCalendarEvent {
  id: string;
  subject?: string | null;
  isOnlineMeeting?: boolean;
  onlineMeeting?: { joinUrl?: string } | null;
  start?: { dateTime?: string; timeZone?: string } | null;
  end?: { dateTime?: string; timeZone?: string } | null;
}

// ----- internal helper shapes -----

export interface DeltaResult<T> {
  items: T[];
  deltaLink: string | null;
}

export interface SyncChannelResult {
  channelId: string;
  channelName: string;
  ingested: number;
}

export interface SyncSummary {
  channels: SyncChannelResult[];
  errors: Array<{ channelId: string; message: string }>;
}

export interface TeamsStatus {
  configured: boolean;
  cachedTokenExpiresAt: Date | null;
  monitoredChannelCount: number;
}

// ----- Graph change-notification subscriptions -----

export interface CreateSubscriptionInput {
  resource: string;
  changeType: string;
  notificationUrl: string;
  lifecycleNotificationUrl?: string;
  clientState: string;
  expirationDateTime: string;
}

export interface GraphSubscription {
  id: string;
  resource: string;
  changeType: string;
  notificationUrl: string;
  expirationDateTime: string;
  clientState?: string;
}

export interface GraphChangeNotification {
  subscriptionId: string;
  clientState?: string;
  changeType?: string;
  resource?: string;
  lifecycleEvent?: 'reauthorizationRequired' | 'subscriptionRemoved' | 'missed';
  resourceData?: { id?: string } | null;
}
