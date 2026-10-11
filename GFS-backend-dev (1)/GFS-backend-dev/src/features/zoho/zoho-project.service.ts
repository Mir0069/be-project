import { ZohoLead } from '@db/models/zoho-lead.model';
import { ProjectCreationSource } from '@db/models/project.model';
import type {
  IDomainProject,
  IProjectRepository,
  IUpdateProjectFields,
} from '@repositories/interfaces/i-project.repository';
import type { CreateProjectInput, IProjectCreator } from '@features/project-creation/project-creation.types';
import { normalizePhoneValue } from '@shared/utils/phone-values';

const MAIL_FIRST_TAG_FIELD = 'Platform_Source';
const MAIL_FIRST_TAG_VALUE = 'MAIL_FIRST';
// Standard Zoho Lead field mail-first always sets; unlike the custom Platform_Source
// it round-trips reliably, so the webhook path can detect mail-first even when it
// wins the create race (otherwise it defaults to ZOHO_FIRST).
const MAIL_FIRST_LEAD_SOURCE = 'outlook mail';

// A claimed-but-unfinished project creation older than this is treated as a
// crashed attempt and may be reclaimed, so a lead can never get permanently
// stuck without a project.
const CREATE_LOCK_TTL_MS = 60_000;

export class ZohoProjectService {
  public constructor(
    private readonly projectCreator: IProjectCreator,
    private readonly projectRepository: IProjectRepository,
  ) {}

  public async createProjectFromLead(
    zohoLeadId: string,
    sourceOverride?: ProjectCreationSource,
    competitiveBidMetadata?: { groupId?: string; isCompetitiveBid?: boolean },
  ): Promise<IDomainProject | null> {
    // Fast-path guard (already linked → nothing to do).
    const preview = await ZohoLead.findOne({ zohoLeadId }).lean();
    if (!preview || preview.projectId) return null;

    // Atomically claim project creation for this lead. findOneAndUpdate on a
    // single document is atomic even on Cosmos DB (unlike the unique index,
    // which Cosmos does not reliably enforce), so mail-first approve and the
    // Zoho webhook/poller can never both create a project for the same lead.
    // Only one caller matches { projectId: null, lock free/stale } and wins.
    const now = new Date();
    const staleBefore = new Date(now.getTime() - CREATE_LOCK_TTL_MS);
    const lead = await ZohoLead.findOneAndUpdate(
      {
        zohoLeadId,
        projectId: null,
        $or: [{ projectCreateLockAt: null }, { projectCreateLockAt: { $lt: staleBefore } }],
      },
      { $set: { projectCreateLockAt: now } },
      { new: false },
    ).lean();
    if (!lead) return null; // lost the race — another caller owns creation for this lead

    try {
      const fullName =
        (lead.fullName && lead.fullName.trim()) || `${lead.firstName ?? ''} ${lead.lastName ?? ''}`.trim();
      const company = lead.company ?? null;

      const addressLine = [lead.street, lead.city, lead.state, lead.zipCode, lead.country]
        .map((part) => (part ? String(part).trim() : ''))
        .filter((part) => part.length > 0)
        .join(', ');
      const projectName =
        (lead.jobAddress ?? '').trim() || addressLine || company || fullName || 'Untitled Project';

      const input: CreateProjectInput = {
        projectName,
        projectAddress: lead.jobAddress ?? null,
        description: lead.description ?? null,
        receivedDate: lead.createdTime ?? null,
        leadStatus: lead.leadStatus ?? null,
        client: {
          customerName: fullName || null,
          customerEmail: lead.email ?? null,
          customerPhone: normalizePhoneValue(lead.phone),
          company,
          website: lead.website ?? null,
        },
        address: {
          street: lead.street ?? null,
          city: lead.city ?? null,
          state: lead.state ?? null,
          zipcode: lead.zipCode ?? null,
          country: lead.country ?? null,
        },
        groupId: competitiveBidMetadata?.groupId ?? null,
        isCompetitiveBid: competitiveBidMetadata?.isCompetitiveBid ?? false,
      };

      const creationSource = sourceOverride ?? this.detectSource(lead.raw);
      const project = await this.projectCreator.create(input, { creationSource, zohoLeadId });

      // Link the real project id (whether newly created or an existing one the
      // creator returned) and release the lock in a single write.
      await ZohoLead.updateOne(
        { zohoLeadId },
        { $set: { projectId: project.id, projectCreateLockAt: null } },
      );
      return project;
    } catch (err) {
      // Release the lock so a later sync can retry creating the project.
      await ZohoLead.updateOne({ zohoLeadId }, { $set: { projectCreateLockAt: null } }).catch(() => undefined);
      throw err;
    }
  }

  public async syncProjectFromLead(projectId: string, lead: Record<string, unknown>): Promise<void> {
    const fullName = this.str(lead['fullName']) || this.str(lead['company']);

    const fields: IUpdateProjectFields = {
      customerEmail: this.str(lead['email']),
      customerPhone: normalizePhoneValue(lead['phone']),
      company: this.str(lead['company']),
      customerWebsite: this.str(lead['website']),
      description: this.str(lead['description']),
      jobAddress: this.str(lead['jobAddress']),
      leadStatus: this.str(lead['leadStatus']),
      address: {
        street: this.str(lead['street']),
        city: this.str(lead['city']),
        state: this.str(lead['state']),
        zipcode: this.str(lead['zipCode']),
        country: this.str(lead['country']),
      },
      receivedDate: (lead['createdTime'] as Date | null | undefined) ?? null,
      lastZohoSyncedAt: new Date(),
    };

    if (fullName) fields.customerName = fullName;

    await this.projectRepository.updateById(projectId, fields);
  }

  private detectSource(raw: unknown): ProjectCreationSource {
    if (raw && typeof raw === 'object') {
      const record = raw as Record<string, unknown>;
      const tag = record[MAIL_FIRST_TAG_FIELD];
      if (typeof tag === 'string' && tag.toUpperCase() === MAIL_FIRST_TAG_VALUE) {
        return ProjectCreationSource.MAIL_FIRST;
      }
      const leadSource = record['Lead_Source'];
      if (typeof leadSource === 'string' && leadSource.trim().toLowerCase() === MAIL_FIRST_LEAD_SOURCE) {
        return ProjectCreationSource.MAIL_FIRST;
      }
    }
    return ProjectCreationSource.ZOHO_FIRST;
  }

  private str(v: unknown): string | null {
    if (v === null || v === undefined || v === '') return null;
    return String(v);
  }
}
