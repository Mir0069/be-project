import mongoose, { Document, Schema } from "mongoose";

export enum ProjectStatus {
    SETUP_PENDING = 'SETUP_PENDING',
    WAITING_FOR_INPUTS = 'WAITING_FOR_INPUTS',
    READY_FOR_ESTIMATOR = 'READY_FOR_ESTIMATOR',
    ESTIMATOR_DRAFTING = 'ESTIMATOR_DRAFTING',
    ESTIMATOR_FINAL = 'ESTIMATOR_FINAL',
    ADMIN_PACKAGING = 'ADMIN_PACKAGING',
    NEEDS_REVISION = 'NEEDS_REVISION',
}

// AI extraction has its own lifecycle. It must not be inferred from the
// project's workflow status because WAITING_FOR_INPUTS is also a valid
// business state after analysis has finished.
export enum ProjectAnalysisStatus {
    NOT_STARTED = 'NOT_STARTED',
    PROCESSING = 'PROCESSING',
    COMPLETED = 'COMPLETED',
    FAILED = 'FAILED',
}

export enum ProjectType {
    NEW_ESTIMATE = "NEW_ESTIMATE",
    RE_QUOTE = "RE_QUOTE",
    VARIATION = "VARIATION",
}

export enum ProjectCreationSource {
    ZOHO_FIRST = 'ZOHO_FIRST',
    MAIL_FIRST = 'MAIL_FIRST',
    MANUAL = 'MANUAL',
}

export interface IProjectAddress {
    street?: string | null;
    city?: string | null;
    state?: string | null;
    zipcode?: string | null;
    country?: string | null;
}

export type ExternalContactSource = 'FROM' | 'TO' | 'CC';

export interface IProjectExternalContact {
    email: string;
    name: string | null;
    sources: ExternalContactSource[];
    firstSeenAt: Date;
    lastSeenAt: Date;
}

/**
 * The active revision request is intentionally stored on the project so the
 * project list can show why work is paused without loading every stage record.
 */
export interface IProjectRevisionRequest {
    stage: number;
    reason: string | null;
    requestedBy: string;
    requestedAt: Date;
}

/**
 * The approved text behind a Zoho/Teams/email re-extraction that is still
 * running, so its AI result can be checked against what was approved.
 */
export interface IProjectActiveRetrigger {
    correlationId: string;
    source: string;
    instruction: string;
    startedAt: Date;
}

export interface IProject extends Document {
    referenceNumber: string;
    projectName: string;
    customerName: string;
    status: ProjectStatus;
    analysisStatus?: ProjectAnalysisStatus;
    projectType: ProjectType;
    creationSource: ProjectCreationSource;

    identifierHash?: string | null;

    zohoLeadId?: string | null;
    jobAddress?: string | null;
    quoteNumber?: string | null;
    leadStatus?: string | null;

    customerEmail?: string | null;
    customerPhone?: string | null;
    company?: string | null;
    customerWebsite?: string | null;
    description?: string | null;
    externalContacts?: IProjectExternalContact[];
    receivedDate?: Date | null;
    address?: IProjectAddress | null;

    blobStorageURL?: string | null;
    dropboxFolderPath?: string | null;

    // Estimator 
    assignedEstimators: mongoose.Types.ObjectId[];
    estimatorName?: string | null;
    estimatorEmail?: string | null;
    estimatorPhone?: string | null;

    lastZohoSyncedAt?: Date | null;

    // sha256 of the last Zoho description + notes snapshot published to the AI,
    // so an unchanged snapshot is not re-sent. Nothing else reads these.
    crmContextHash?: string | null;
    crmContextSentAt?: Date | null;

    activeRetrigger?: IProjectActiveRetrigger | null;

    createdAt: Date;
    updatedAt: Date;
    isActive: boolean;

    dueDate?: Date | null;
    estimatedCost?: number | null;
    totalSqFt?: number | null;

    // Competitive bidding support - each bidder gets separate project, linked by groupId
    groupId?: string | null; // Groups projects at same address
    isCompetitiveBid?: boolean; // Indicates this project is part of competitive bidding
    relatedProjectIds?: mongoose.Types.ObjectId[]; // Other projects at same address
    partnerName?: string | null;
    revisionRequest?: IProjectRevisionRequest | null;
}

const ProjectAddressSchema = new Schema<IProjectAddress>(
    {
        street: { type: String, default: null },
        city: { type: String, default: null },
        state: { type: String, default: null },
        zipcode: { type: String, default: null },
        country: { type: String, default: null },
    },
    { _id: false },
);

const ProjectExternalContactSchema = new Schema<IProjectExternalContact>(
    {
        email: { type: String, required: true, trim: true, lowercase: true },
        name: { type: String, default: null },
        sources: { type: [String], enum: ['FROM', 'TO', 'CC'], default: [] },
        firstSeenAt: { type: Date, required: true },
        lastSeenAt: { type: Date, required: true },
    },
    { _id: false },
);

const ProjectRevisionRequestSchema = new Schema<IProjectRevisionRequest>(
    {
        stage: { type: Number, required: true, min: 1, max: 7 },
        reason: { type: String, default: null },
        requestedBy: { type: String, required: true },
        requestedAt: { type: Date, required: true },
    },
    { _id: false },
);

const ProjectActiveRetriggerSchema = new Schema<IProjectActiveRetrigger>(
    {
        correlationId: { type: String, required: true },
        source: { type: String, required: true },
        instruction: { type: String, required: true },
        startedAt: { type: Date, required: true },
    },
    { _id: false },
);

const ProjectSchema = new Schema<IProject>({
    referenceNumber: { type: String, required: true, unique: true },
    projectName: { type: String, required: true, trim: true },
    customerName: { type: String, required: true, trim: true },
    status: { type: String, required: true, enum: Object.values(ProjectStatus), default: ProjectStatus.SETUP_PENDING },
    analysisStatus: { type: String, enum: Object.values(ProjectAnalysisStatus), default: ProjectAnalysisStatus.NOT_STARTED },
    projectType: { type: String, required: true, enum: Object.values(ProjectType) },
    creationSource: { type: String, enum: Object.values(ProjectCreationSource), default: ProjectCreationSource.ZOHO_FIRST },

    identifierHash: { type: String, default: null, index: true },

    zohoLeadId: { type: String, default: null, required: false },
    jobAddress: { type: String, default: null, required: false },
    quoteNumber: { type: String, default: null, required: false },
    leadStatus: { type: String, default: null, required: false },

    customerEmail: { type: String, default: null },
    customerPhone: { type: String, default: null },
    company: { type: String, default: null },
    customerWebsite: { type: String, default: null },
    description: { type: String, default: null },
    // Normalized external participants are retained at project level so the
    // contact history survives email cleanup and is cheap to read in the UI.
    externalContacts: { type: [ProjectExternalContactSchema], default: [] },
    receivedDate: { type: Date, default: null },
    address: { type: ProjectAddressSchema, default: null },

    blobStorageURL: { type: String, default: null, required: false },
    dropboxFolderPath: { type: String, default: null, required: false },

    assignedEstimators: [{ type: Schema.Types.ObjectId, ref: "User" }],
    estimatorName: { type: String, default: null },
    estimatorEmail: { type: String, default: null },
    estimatorPhone: { type: String, default: null },

    lastZohoSyncedAt: { type: Date, default: null },

    crmContextHash: { type: String, default: null },
    crmContextSentAt: { type: Date, default: null },

    activeRetrigger: { type: ProjectActiveRetriggerSchema, default: null },

    isActive: { type: Boolean, default: true },
    dueDate: { type: Date, required: false },
    estimatedCost: { type: Number, default: null },
    totalSqFt: { type: Number, default: null },

    // Competitive bidding support - each bidder gets separate project, linked by groupId
    groupId: { type: String, default: null, index: true },
    isCompetitiveBid: { type: Boolean, default: false },
    relatedProjectIds: { type: [Schema.Types.ObjectId], default: [] },
    partnerName: { type: String, default: null, trim: true },
    revisionRequest: { type: ProjectRevisionRequestSchema, default: null },
},
{ timestamps: true });

ProjectSchema.index(
    { zohoLeadId: 1 },
    { unique: true, partialFilterExpression: { zohoLeadId: { $type: 'string' } } },
);
ProjectSchema.index({ assignedEstimators: 1 });
ProjectSchema.index({ status: 1, isActive: 1 });

export const Project = mongoose.model<IProject>("Project", ProjectSchema);
