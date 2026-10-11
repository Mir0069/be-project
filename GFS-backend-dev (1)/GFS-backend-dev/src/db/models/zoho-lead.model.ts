import mongoose, { Document, Schema } from 'mongoose';

export interface IZohoLeadNote {
  noteId: string;
  content: string;
  author?: string | null;
  authorEmail?: string | null;
  createdTime?: Date | null;
  // Zoho moves this when the note text is edited; createdTime stays frozen at the
  // original write, so this is the only way to date a change to existing text.
  modifiedTime?: Date | null;
}

/**
 * One past state of this lead's description + notes, appended whenever the text
 * changes. `notes` is the full set at that moment, not a delta, so a version can
 * be read on its own.
 */
export interface IZohoLeadNoteVersion {
  // sha256 of the description + notes body. Matches the project's
  // crmContextHash for the newest version, and makes the append idempotent.
  hash: string;
  description?: string | null;
  // When the DESCRIPTION last actually changed, on Zoho's own clock, so it can
  // be compared with a note's createdTime/modifiedTime. Taken from the lead's
  // Modified_Time at the moment the text was seen to differ: adding a note does
  // not move Modified_Time (only Last_Activity_Time), so a move paired with
  // changed description text dates the edit itself. Carried forward unchanged
  // on versions where only the notes moved.
  descriptionChangedAt?: Date | null;
  notes: IZohoLeadNote[];
  capturedAt: Date;
}

export interface IZohoLead extends Document {
  zohoLeadId: string;
  firstName: string;
  lastName: string;
  fullName?: string | null;
  company: string;
  email?: string | null;
  phone: string;
  mobile?: string | null;
  leadStatus?: string | null;
  leadSource?: string | null;
  timeline?: string | null;
  description?: string | null;
  whatResource?: string | null;
  lastActivity?: string | null;
  jobAddress?: string | null;
  state?: string | null;
  street?: string | null;
  city?: string | null;
  zipCode?: string | null;
  country?: string | null;
  website?: string | null;
  quoteNumber?: string | null;
  ownerName?: string | null;
  ownerEmail?: string | null;
  createdTime?: Date | null;
  modifiedTime?: Date | null;
  // Current notes, replaced on every sync that sees a change.
  notes: IZohoLeadNote[];
  // Every past state, oldest first. Append-only: a corrected note produces a new
  // version rather than editing one.
  noteHistory?: IZohoLeadNoteVersion[];
  projectId?: mongoose.Types.ObjectId | null;
  // Set atomically while a project is being created for this lead so that
  // concurrent callers (mail-first approve + Zoho webhook/poller) can never
  // both create one. Cleared once the project is linked; a stale value (older
  // than the create-lock TTL, i.e. a crashed attempt) may be reclaimed.
  projectCreateLockAt?: Date | null;
  // Full raw Zoho record as last fetched — lets the test UI render every Zoho
  // field (incl. custom ones) and lets the sync diff detect any field change.
  raw?: Record<string, unknown> | null;
  fetchedAt: Date;
  lastSyncedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const ZohoLeadNoteSchema = new Schema<IZohoLeadNote>(
  {
    noteId: { type: String, required: true },
    content: { type: String, default: '' },
    author: { type: String, default: null },
    authorEmail: { type: String, default: null },
    createdTime: { type: Date, default: null },
    modifiedTime: { type: Date, default: null },
  },
  { _id: false },
);

const ZohoLeadNoteVersionSchema = new Schema<IZohoLeadNoteVersion>(
  {
    hash: { type: String, required: true },
    description: { type: String, default: null },
    descriptionChangedAt: { type: Date, default: null },
    notes: { type: [ZohoLeadNoteSchema], default: [] },
    capturedAt: { type: Date, required: true },
  },
  { _id: false },
);

const ZohoLeadSchema = new Schema<IZohoLead>(
  {
    zohoLeadId: { type: String, required: true, unique: true },
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    fullName: { type: String, default: null },
    company: { type: String, required: true },    
    email: { type: String, default: null },
    phone: { type: String, required: true },
    mobile: { type: String, default: null },
    leadStatus: { type: String, default: null },
    leadSource: { type: String, default: null },
    timeline: { type: String, default: null },
    description: { type: String, default: null },
    whatResource: { type: String, default: null },
    lastActivity: { type: String, default: null },
    jobAddress: { type: String, default: null },
    state: { type: String, default: null },
    street: { type: String, default: null },
    city: { type: String, default: null },
    zipCode: { type: String, default: null },
    country: { type: String, default: null },
    website: { type: String, default: null },
    quoteNumber: { type: String, default: null },
    ownerName: { type: String, default: null },
    ownerEmail: { type: String, default: null },
    createdTime: { type: Date, default: null },
    modifiedTime: { type: Date, default: null },
    notes: { type: [ZohoLeadNoteSchema], default: [] },
    noteHistory: { type: [ZohoLeadNoteVersionSchema], default: [] },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', default: null },
    projectCreateLockAt: { type: Date, default: null },
    raw: { type: Schema.Types.Mixed, default: null },
    fetchedAt: { type: Date, required: true },
    lastSyncedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

ZohoLeadSchema.index({ leadStatus: 1 });
ZohoLeadSchema.index({ projectId: 1 });
ZohoLeadSchema.index({ modifiedTime: -1 });      

export const ZohoLead = mongoose.model<IZohoLead>('ZohoLead', ZohoLeadSchema);
