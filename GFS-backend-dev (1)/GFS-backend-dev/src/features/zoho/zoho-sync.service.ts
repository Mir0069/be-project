import { ZohoLead } from "@db/models/zoho-lead.model";
import { ProjectCreationSource } from "@db/models/project.model";
import {
  ZohoLeadChange,
  type ZohoLeadChangeSource,
} from "@db/models/zoho-lead-change.model";

import type { ZohoService } from "./zoho.service";
import type { ZohoProjectService } from "./zoho-project.service";
import type { IProjectCreatedNotifier } from "./project-notifier.port";
import type { IProjectTeamsProvisioner } from "./teams-provisioner.port";
import type { IProjectCrmContextPublisher } from "./crm-context.port";


export const IGNORED_STATUSES = new Set([
  "spam",
  "closed",
  "dead",
  "completed",
  "sold",
  "modular system sold",
  "not qualified",
]);

// Scalar Zoho fields that change on every edit or are pure system noise — we
// don't want these polluting the "what changed" feed. (Keys starting with "$"
// are skipped separately.)
const NOISE_FIELDS = new Set([
  "Modified_Time",
  "Created_Time",
  "Last_Activity_Time",
  "Last_Enriched_Time__s",
  "Enrich_Status__s",
  "Record_Image",
  "id",
]);

interface RecordsResponse {
  data?: Array<Record<string, unknown>>;
  info?: { more_records?: boolean };
}

interface FieldDiff {
  field: string;
  oldValue: string | null;
  newValue: string | null;
}

export interface SyncSummary {
  scanned: number;
  ignored: number;
  created: number;
  updated: number;
  changeEntries: number;
}

const PAGE = 200;

export class ZohoSyncService {
  public constructor(
    private readonly zohoService: ZohoService,
    private readonly projectService: ZohoProjectService,
    private readonly notifier?: IProjectCreatedNotifier,
    private readonly teamsProvisioner?: IProjectTeamsProvisioner,
    private readonly crmContext?: IProjectCrmContextPublisher,
  ) {}

  // ---- helpers -----------------------------------------------------------

  private static str(v: unknown): string | null {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "object") return null; // owner objects etc. handled explicitly
    return String(v);
  }

  private static isScalar(v: unknown): boolean {
    return v === null || ["string", "number", "boolean"].includes(typeof v);
  }

  private static isIgnored(raw: Record<string, unknown>): boolean {
    const status = ZohoSyncService.str(raw["Lead_Status"]);
    return status ? IGNORED_STATUSES.has(status.trim().toLowerCase()) : false;
  }

  /** Map a raw Zoho lead into our ZohoLead document fields. */
  private mapRawToDoc(raw: Record<string, unknown>): Record<string, unknown> {
    const owner = (raw["Owner"] ?? null) as {
      name?: string;
      email?: string;
    } | null;
    const s = ZohoSyncService.str;
    return {
      zohoLeadId: s(raw["id"]) ?? "",
      firstName: s(raw["First_Name"]) ?? "",
      lastName: s(raw["Last_Name"]) ?? "",
      fullName: s(raw["Full_Name"]),
      company: s(raw["Company"]) ?? "",
      email: s(raw["Email"]),
      phone: s(raw["Phone"]) ?? "",
      mobile: s(raw["Mobile"]),
      leadStatus: s(raw["Lead_Status"]),
      leadSource: s(raw["Lead_Source"]),
      description: s(raw["Description"]),
      state: s(raw["State"]),
      // Surface only Zoho's standard `Street` as the project's street. This org
      // normally leaves it blank (the location lives in the custom `Address` field),
      // so street is usually null and the UI hides it. The single canonical address
      // lives in `jobAddress` below, which prefers `Job_Address` and falls back to the
      // custom `Address` field for leads that only set that. Keeping the location out
      // of `street` stops a project from ever showing two different addresses
      // (a stale street vs the jobAddress) when the name/address is edited before approval.
      street: s(raw["Street"]),
      jobAddress: s(raw["Job_Address"]) ?? s(raw["Address"]),
      city: s(raw["City"]),
      zipCode: s(raw["Zip_Code"]),
      country: s(raw["Country"]),
      website: s(raw["Website"]),
      ownerName: owner?.name ?? null,
      ownerEmail: owner?.email ?? null,
      createdTime: raw["Created_Time"]
        ? new Date(String(raw["Created_Time"]))
        : null,
      modifiedTime: raw["Modified_Time"]
        ? new Date(String(raw["Modified_Time"]))
        : null,
    };
  }

  /** Diff two raw records, returning meaningful scalar field changes. */
  private diffRaw(
    oldRaw: Record<string, unknown>,
    newRaw: Record<string, unknown>,
  ): FieldDiff[] {
    const diffs: FieldDiff[] = [];
    for (const key of Object.keys(newRaw)) {
      if (key.startsWith("$") || NOISE_FIELDS.has(key)) continue;
      const newV = newRaw[key];
      const oldV = oldRaw[key];
      if (!ZohoSyncService.isScalar(newV) && !ZohoSyncService.isScalar(oldV))
        continue;
      const oldStr = ZohoSyncService.str(oldV);
      const newStr = ZohoSyncService.str(newV);
      if (oldStr !== newStr)
        diffs.push({ field: key, oldValue: oldStr, newValue: newStr });
    }
    return diffs;
  }

  // ---- core sync ---------------------------------------------------------

  /** Upsert one raw lead and log its changes. Returns null if it has no id. */
  public async syncLead(
    raw: Record<string, unknown>,
    source: ZohoLeadChangeSource,
    now: Date,
    sourceOverride?: ProjectCreationSource,
    competitiveBidMetadata?: { groupId?: string; isCompetitiveBid?: boolean },
  ): Promise<{ created: boolean; changeEntries: number } | null> {
    const zohoLeadId = ZohoSyncService.str(raw["id"]);
    if (!zohoLeadId) return null;

    const existing = await ZohoLead.findOne({ zohoLeadId }).lean();
    const mapped = this.mapRawToDoc(raw);
    const leadName =
      (mapped["fullName"] as string | null) ??
      `${mapped["firstName"] ?? ""} ${mapped["lastName"] ?? ""}`.trim();

    const changeDocs: Array<Record<string, unknown>> = [];
    if (!existing) {
      // The initial backfill seeds many leads at once — that's not a
      // "notification". Only log CREATED for leads that newly appear later
      // (via webhook/poll), which is a real event worth surfacing.
      if (source !== "backfill") {
        changeDocs.push({
          zohoLeadId,
          leadName,
          type: "CREATED",
          changedAt: now,
          source,
        });
      }
    } else {
      const prevRaw = (existing.raw ?? {}) as Record<string, unknown>;
      for (const d of this.diffRaw(prevRaw, raw)) {
        changeDocs.push({
          zohoLeadId,
          leadName,
          type: "UPDATED",
          field: d.field,
          oldValue: d.oldValue,
          newValue: d.newValue,
          changedAt: now,
          source,
        });
      }
    }

    // Validators off by default on findOneAndUpdate — avoids required-field
    // failures for leads missing e.g. a phone number.
    await ZohoLead.updateOne(
      { zohoLeadId },
      { $set: { ...mapped, raw, fetchedAt: now, lastSyncedAt: now } },
      { upsert: true, setDefaultsOnInsert: true },
    );

    if (changeDocs.length > 0) await ZohoLeadChange.insertMany(changeDocs);

    const leadStatus = (ZohoSyncService.str(mapped["leadStatus"]) ?? "")
      .trim()
      .toLowerCase();
    const existingProjectId = existing?.projectId ?? null;
    let crmContextProjectId: string | null = null;
    try {
      if (existingProjectId) {
        await this.projectService.syncProjectFromLead(
          String(existingProjectId),
          mapped,
        );
        crmContextProjectId = String(existingProjectId);
      } else if (leadStatus === "need to quote") {
        const createdProject = await this.projectService.createProjectFromLead(
          zohoLeadId,
          sourceOverride,
          competitiveBidMetadata,
        );
        if (createdProject && this.notifier) {
          await this.notifier.notifyProjectCreated({
            projectId: createdProject.id,
            referenceNumber: createdProject.referenceNumber,
            projectName: createdProject.projectName,
            zohoLeadId,
            leadName: leadName || null,
            leadStatus: ZohoSyncService.str(mapped["leadStatus"]),
            creationSource: createdProject.creationSource,
          });
        }
        // Auto-provision a Teams workspace (Zoho-first + mail-first only reach
        // here). Enqueue-and-kick: returns instantly and never throws.
        if (createdProject && this.teamsProvisioner) {
          await this.teamsProvisioner.provisionForProject({
            projectId: createdProject.id,
            projectName: createdProject.projectName,
          });
        }
        if (createdProject) crmContextProjectId = createdProject.id;
      }
    } catch (err) {
      console.error(
        `[ZohoSync] project operation failed for lead ${zohoLeadId}:`,
        err,
      );
    }

    // Send the lead's description + notes to the AI. Runs after the project row
    // has taken this sync's description, and only ever publishes when the
    // snapshot actually changed, so calling it on every sync is cheap. Detached
    // on purpose: neither Zoho nor the queue may hold up or fail a sync.
    if (crmContextProjectId && this.crmContext) {
      void this.crmContext
        .publishForProject(crmContextProjectId)
        .catch((err: unknown) =>
          console.error(
            `[ZohoSync] crm-context publish failed for lead ${zohoLeadId}:`,
            err instanceof Error ? err.message : err,
          ),
        );
    }

    return { created: !existing, changeEntries: changeDocs.length };
  }

  // ---- fetching ----------------------------------------------------------

  /**
   * Fetch full lead records whose `dateField` falls in [fromMs, toMs], by
   * sorting descending and walking pages until we cross below `fromMs`.
   */
  private async fetchLeadsByWindow(
    dateField: "Created_Time" | "Modified_Time" | "Last_Activity_Time",
    fromMs: number,
    toMs: number,
  ): Promise<Array<Record<string, unknown>>> {
    const all: Array<Record<string, unknown>> = [];
    let page = 1;

    for (;;) {
      const resp = await this.zohoService.fetchFromZoho<
        RecordsResponse | string
      >("/crm/v2/Leads", {
        sort_by: dateField,
        sort_order: "desc",
        page: String(page),
        per_page: String(PAGE),
      });
      const rows =
        typeof resp === "object" && resp !== null ? (resp.data ?? []) : [];
      if (rows.length === 0) break;

      let crossed = false;
      for (const lead of rows) {
        const ts = new Date(String(lead[dateField] ?? "")).getTime();
        if (Number.isNaN(ts)) continue;
        if (ts < fromMs) {
          crossed = true;
          continue;
        }
        if (ts <= toMs) all.push(lead);
      }

      const more =
        typeof resp === "object" && resp !== null
          ? resp.info?.more_records
          : false;
      if (crossed || !more) break;
      page += 1;
      if (page > 50) break; // safety cap (10k records)
    }

    return all;
  }

  private async runSync(
    leads: Array<Record<string, unknown>>,
    source: ZohoLeadChangeSource,
  ): Promise<SyncSummary> {
    const now = new Date();
    const summary: SyncSummary = {
      scanned: leads.length,
      ignored: 0,
      created: 0,
      updated: 0,
      changeEntries: 0,
    };

    for (const raw of leads) {
      if (ZohoSyncService.isIgnored(raw)) {
        summary.ignored += 1;
        continue;
      }
      const result = await this.syncLead(raw, source, now);
      if (!result) continue;
      if (result.created) summary.created += 1;
      else if (result.changeEntries > 0) summary.updated += 1;
      summary.changeEntries += result.changeEntries;
    }

    return summary;
  }

  /** Backfill all (non-ignored) leads CREATED within the window. */
  public async backfill(fromIso: string, toIso: string): Promise<SyncSummary> {
    const leads = await this.fetchLeadsByWindow(
      "Created_Time",
      new Date(fromIso).getTime(),
      new Date(toIso).getTime(),
    );
    return this.runSync(leads, "backfill");
  }

  /** Fetch one lead by id from Zoho (read-only) and sync it. */
  public async syncLeadById(
    zohoLeadId: string,
    source: ZohoLeadChangeSource = "webhook",
    sourceOverride?: ProjectCreationSource,
    competitiveBidMetadata?: { groupId?: string; isCompetitiveBid?: boolean },
  ): Promise<{ created: boolean; changeEntries: number } | null> {
    const resp = await this.zohoService.fetchFromZoho<
      { data?: Array<Record<string, unknown>> } | string
    >(`/crm/v2/Leads/${zohoLeadId}`);
    const raw =
      typeof resp === "object" && resp !== null
        ? (resp.data?.[0] ?? null)
        : null;
    if (!raw) return null;
    return this.syncLead(
      raw,
      source,
      new Date(),
      sourceOverride,
      competitiveBidMetadata,
    );
  }

  /**
   * Re-sync all (non-ignored) leads touched since `sinceMs`.
   *
   * Two windows, not one. Adding a Note to a lead does NOT move its
   * Modified_Time — only Last_Activity_Time — so a Modified_Time scan alone
   * misses leads whose only change was a new note, and the webhook that Zoho
   * fires for that note would find nothing to sync. Verified on lead
   * 7344067000096065047: two notes moved Last_Activity_Time 22:27 -> 22:29 while
   * Modified_Time stayed at 22:27:35.
   */
  public async syncModifiedSince(
    sinceMs: number,
    source: ZohoLeadChangeSource = "poll",
  ): Promise<SyncSummary> {
    const toMs = Date.now() + 60_000;
    const [modified, active] = await Promise.all([
      this.fetchLeadsByWindow("Modified_Time", sinceMs, toMs),
      this.fetchLeadsByWindow("Last_Activity_Time", sinceMs, toMs),
    ]);

    // A lead edited AND noted in the window comes back from both scans; sync it once.
    const byId = new Map<string, Record<string, unknown>>();
    for (const lead of [...modified, ...active]) {
      const id = ZohoSyncService.str(lead["id"]);
      if (id && !byId.has(id)) byId.set(id, lead);
    }

    return this.runSync([...byId.values()], source);
  }
}
