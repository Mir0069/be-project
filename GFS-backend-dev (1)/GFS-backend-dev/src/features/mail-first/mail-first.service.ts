import mongoose from "mongoose";
import { StatusCodes } from "http-status-codes";

import {
  OutlookEmail,
  type IAIBidder,
  type IOutlookEmail,
} from "@db/models/outlook-email.model";
import { ProjectCreationSource } from "@db/models/project.model";
import { AppError } from "@shared/errors/app.error";
import { env } from "@config/index";
import type { ZohoService } from "@features/zoho/zoho.service";
import type { ZohoSyncService } from "@features/zoho/zoho-sync.service";

import type {
  MailFirstApprovalResult,
  ZohoInsertResponse,
} from "./mail-first.types";
import type { BlobStorage } from "@features/document-ingestion/document-ingestion.types";
import { projectCreationService } from "@features/project-creation/project-creation.router";
import { normalizePhoneValue } from "@shared/utils/phone-values";
import { proposalService } from "@features/proposal/proposal.router";
import { outlookService } from "@features/outlook/outlook.router";
import { dropboxSyncService } from "@features/projects/dropbox-sync.service";
import { MongooseProjectRepository } from "@repositories/mongoose/project.repository";
import { MongooseOutlookEmailRepository } from "@repositories/mongoose/outlook-email.repository";
import { refreshExternalContactsForProject } from "@features/project-workspace/external-contacts";

const LEADS_PATH = "/crm/v2/Leads";
const NEED_TO_QUOTE = "Need to Quote";
const MAIL_FIRST_TAG_FIELD = "Platform_Source";
const MAIL_FIRST_TAG_VALUE = "MAIL_FIRST";
const LEAD_SOURCE = "Outlook Mail";

export class MailFirstService {
  public constructor(
    private readonly zohoService: ZohoService,
    private readonly zohoSyncService: ZohoSyncService,
    private readonly blobStorage: BlobStorage,
  ) {}

  /**
   * `Owner` for a lead we are about to create, from ZOHO_DEFAULT_LEAD_OWNER.
   * Zoho otherwise gives the lead to whichever account authorized our OAuth
   * connection, which is a service account rather than the person who has to
   * follow it up. Config names that person by email because an email survives
   * the move to a different Zoho tenant, while a user id does not.
   *
   * Never fatal: if the address is unset or matches no active Zoho user the
   * lead is still created, just owned the old way. Losing the owner is not a
   * reason to fail an approval the estimator already made.
   */
  private async leadOwnerField(): Promise<Record<string, unknown>> {
    const configured = env.zoho.defaultLeadOwner?.trim();
    if (!configured) return {};

    try {
      const ownerId = configured.includes("@")
        ? await this.zohoService.resolveUserIdByEmail(configured)
        : configured;
      if (!ownerId) {
        console.warn(
          `[MailFirst] ZOHO_DEFAULT_LEAD_OWNER "${configured}" matches no active Zoho user. ` +
            `Creating the lead without an explicit owner.`,
        );
        return {};
      }
      return { Owner: { id: ownerId } };
    } catch (err) {
      console.warn(
        `[MailFirst] Could not resolve ZOHO_DEFAULT_LEAD_OWNER "${configured}":`,
        (err as Error)?.message ?? err,
      );
      return {};
    }
  }

  public async approveDraft(emailId: string): Promise<MailFirstApprovalResult> {
    const email = await OutlookEmail.findById(emailId);
    if (!email)
      throw new AppError("Draft email not found", StatusCodes.NOT_FOUND);

    if (email.status === "CONFIRMED") {
      if (!email.projectId) {
        throw new AppError(
          "This approved draft is not linked to a project and needs recovery before it can continue.",
          StatusCodes.CONFLICT,
        );
      }
      return {
        zohoLeadId: null,
        projectId: String(email.projectId),
        alreadyProcessed: true,
      };
    }
    if (email.status !== "DRAFT") {
      throw new AppError(
        `Cannot approve an email in status ${email.status}`,
        StatusCodes.CONFLICT,
      );
    }
    if (!email.proposed) {
      throw new AppError(
        "Email has no AI proposal to approve",
        StatusCodes.BAD_REQUEST,
      );
    }

    // Handle competitive bidding - create separate projects for each bidder
    const allBidders = email.proposed.allBidders as Array<{
      email?: string;
      company?: string;
      isPrimary?: boolean;
    }> | null;
    if (
      email.proposed.isCompetitiveBid &&
      allBidders &&
      allBidders.length > 1
    ) {
      return this.approveCompetitiveBid(email, allBidders);
    }

    // Normal single-bidder flow
    let zohoLeadId = email.zohoLeadId ?? null;
    if (!zohoLeadId) {
      try {
        const payload = await this.buildLeadPayload(email);
        const response =
          await this.zohoService.insertIntoZoho<ZohoInsertResponse>(LEADS_PATH, {
            data: [payload],
          });
        zohoLeadId = response.data?.[0]?.details?.id ?? null;
        if (zohoLeadId) {
          // The external lead exists before we attempt local project creation.
          // Persist it now so a retry resumes this lead instead of duplicating it.
          await OutlookEmail.updateOne(
            { _id: email._id },
            { $set: { zohoLeadId } },
          );
          email.zohoLeadId = zohoLeadId;
        }
      } catch (err) {
        console.warn(
          `[MailFirstService] Zoho insert skipped or failed (${(err as Error)?.message ?? err}). Proceeding with local project creation fallback.`,
        );
      }
    }

    let finalProjectId: string | null = null;

    if (zohoLeadId) {
      try {
        await this.zohoSyncService.syncLeadById(
          zohoLeadId,
          "webhook",
          ProjectCreationSource.MAIL_FIRST,
        );

        // --- RACE CONDITION FIX: Wait for Zoho Webhook to create the project ---
        // Poll the database for up to 10 seconds waiting for the project to appear
        for (let i = 0; i < 10; i++) {
          const existingProject = (await mongoose
            .model("Project")
            .findOne({ zohoLeadId })
            .lean()) as any;

          if (existingProject && existingProject._id) {
            finalProjectId = String(existingProject._id);

            // The webhook missed the creation source. Let's fix it right now!
            if (existingProject.creationSource === "ZOHO_FIRST") {
              await mongoose
                .model("Project")
                .updateOne(
                  { _id: existingProject._id },
                  { $set: { creationSource: "MAIL_FIRST" } },
                );
            }
            break; // We found the project, exit the waiting loop!
          }
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      } catch (err) {
        console.warn(
          `[MailFirstService] Zoho lead sync failed for ${zohoLeadId}:`,
          (err as Error)?.message ?? err,
        );
      }
    }

    if (!finalProjectId) {
      // Local fallback: create the project directly in MongoDB via projectCreationService!
      const projectName =
        email.proposed?.projectName?.trim() ||
        email.subject?.trim() ||
        "Untitled Project";
      const created = await projectCreationService.create(
        {
          projectName,
          projectAddress:
            email.proposed?.jobAddress?.trim() ||
            email.proposed?.address?.trim() ||
            null,
          description:
            email.proposed?.summary?.trim() || email.bodyText?.trim() || null,
          receivedDate: email.receivedDateTime
            ? new Date(email.receivedDateTime)
            : new Date(),
          leadStatus: NEED_TO_QUOTE,
          client: {
            customerName:
              email.proposed?.customerName?.trim() ||
              email.fromName?.trim() ||
              null,
            customerEmail: email.fromAddress?.trim() || null,
            customerPhone: normalizePhoneValue(email.proposed?.customerPhone),
            company:
              email.proposed?.companyName?.trim() ||
              email.proposed?.customerName?.trim() ||
              null,
          },
          address: email.proposed?.jobAddress?.trim()
            ? { street: email.proposed.jobAddress.trim() }
            : undefined,
        },
        {
          creationSource: ProjectCreationSource.MAIL_FIRST,
          zohoLeadId: zohoLeadId ?? undefined,
        },
      );
      finalProjectId = String(created.id);
    }

    const statusUpdate: Record<string, unknown> = { status: "CONFIRMED" };

    // NEW: collect the ids of every Document we actually link to this project
    // below, so we can tell triggerStage0Extraction exactly which documents
    // are new — instead of it re-pulling every active document on the project.
    const matchedDocumentIds: string[] = [];

    if (finalProjectId) {
      statusUpdate["projectId"] = new mongoose.Types.ObjectId(finalProjectId);
      statusUpdate["linkMethod"] = "AUTO";

      // --- DOCUMENT LINKING LOGIC ---
      if (email.attachments && email.attachments.length > 0) {
        const storageKeys = email.attachments
          .map((att: any) => att.storageKey)
          .filter(Boolean);

        if (storageKeys.length > 0) {
          try {
            // CHANGED: find first (to capture ids for the extraction trigger),
            // then update, instead of a blind updateMany.
            const matched = await mongoose
              .model("Document")
              .find({ storageKey: { $in: storageKeys } }, { _id: 1 })
              .lean();
            matchedDocumentIds.push(...matched.map((d: any) => String(d._id)));

            await mongoose.model("Document").updateMany(
              { storageKey: { $in: storageKeys } },
              {
                $set: {
                  // Force MongoDB ObjectId type!
                  projectId: new mongoose.Types.ObjectId(finalProjectId),
                  status: "PROCESSED",
                  isActive: true,
                },
              },
            );
          } catch (err) {
            console.error("Failed to link documents to approved project", err);
          }
        }
      }

      // Also link any cloud-resolved documents staged for this email
      try {
        // CHANGED: same find-then-update pattern as above.
        const matchedCloud = await mongoose
          .model("Document")
          .find(
            { "metadata.emailId": { $in: [email._id.toString(), email._id] } },
            { _id: 1 },
          )
          .lean();
        matchedDocumentIds.push(...matchedCloud.map((d: any) => String(d._id)));

        await mongoose.model("Document").updateMany(
          { "metadata.emailId": { $in: [email._id.toString(), email._id] } },
          {
            $set: {
              projectId: new mongoose.Types.ObjectId(finalProjectId),
              status: "PROCESSED",
              isActive: true,
            },
          },
        );
      } catch (err) {
        console.error(
          "Failed to link cloud-resolved documents to approved project",
          err,
        );
      }
      // Trigger immediate outward Dropbox sync for newly linked email attachments
      const projRepo = new MongooseProjectRepository();
      projRepo
        .findById(finalProjectId)
        .then((proj) => {
          if (proj) {
            dropboxSyncService
              .outwardSync(proj)
              .catch((err) =>
                console.error(
                  `[MailFirstService] outwardSync failed for project ${finalProjectId}:`,
                  err,
                ),
              );
          }
        })
        .catch(() => {});
      // ------------------------------
    }

    await OutlookEmail.updateOne({ _id: email._id }, { $set: statusUpdate });

    if (finalProjectId) {
      // Mail-first approval links the source email directly, so refresh the
      // persisted external-contact snapshot before downstream extraction.
      try {
        await refreshExternalContactsForProject(
          finalProjectId,
          new MongooseProjectRepository(),
          new MongooseOutlookEmailRepository(),
        );
      } catch (err) {
        console.error(
          `[MailFirstService] external contact refresh failed for ${finalProjectId}:`,
          err,
        );
      }

      try {
        // CHANGED: new signature — pass only the newly-linked document ids,
        // plus subject/fromAddress/correlationId instead of the whole email.
        await proposalService.triggerStage0Extraction(
          finalProjectId,
          matchedDocumentIds,
          {
            subject: email.subject ?? undefined,
            fromAddress: email.fromAddress ?? undefined,
            correlationId: `outlookEmail:${String(email._id)}`,
          },
        );
      } catch (err) {
        console.error(
          `Failed to trigger Stage 0 Extraction for project ${finalProjectId}`,
          err,
        );
      }
    } else {
      console.warn(
        `[MailFirstService] finalProjectId is null, skipping Stage 0 extraction trigger for email ${email._id}`,
      );
    }

    return { zohoLeadId, projectId: finalProjectId, alreadyProcessed: false };
  }
  private async approveCompetitiveBid(
    email: IOutlookEmail,
    bidders: IAIBidder[],
  ): Promise<MailFirstApprovalResult> {
    const groupId = email.proposed?.groupId?.trim();
    if (!groupId) {
      throw new AppError(
        "Competitive bid is missing its group id",
        StatusCodes.BAD_REQUEST,
      );
    }

    // De-duplicate AI output before creating external Zoho records. This also makes
    // an approval retry reuse projects that were completed before a partial failure.
    const uniqueBidders = Array.from(
      new Map(
        bidders
          .filter((bidder) => bidder.email?.trim())
          .map((bidder) => [bidder.email!.trim().toLowerCase(), bidder]),
      ).values(),
    );
    if (uniqueBidders.length < 2) {
      throw new AppError(
        "Competitive bid requires at least two unique bidder emails",
        StatusCodes.BAD_REQUEST,
      );
    }

    const primaryBidderEmail = (email.proposed?.primaryBidderEmail ||
      uniqueBidders.find((bidder) => bidder.isPrimary)?.email ||
      uniqueBidders[0]!.email)!
      .trim()
      .toLowerCase();
    const createdProjectIds: string[] = [];
    const createdZohoLeadIds: string[] = [];
    let primaryProjectId: string | null = null;
    let primaryZohoLeadId: string | null = null;

    for (const bidder of uniqueBidders) {
      const bidderEmail = bidder.email!.trim().toLowerCase();
      const bidderCompany =
        bidder.company || email.proposed?.companyName || "Unknown";

      const alreadyCreated = (await mongoose
        .model("Project")
        .findOne({
          groupId,
          customerEmail: {
            $regex: `^${bidderEmail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
            $options: "i",
          },
        })
        .lean()) as any;

      if (alreadyCreated?._id) {
        const existingProjectId = String(alreadyCreated._id);
        createdProjectIds.push(existingProjectId);
        if (alreadyCreated.zohoLeadId)
          createdZohoLeadIds.push(String(alreadyCreated.zohoLeadId));
        if (bidderEmail === primaryBidderEmail || bidder.isPrimary) {
          primaryProjectId = existingProjectId;
          primaryZohoLeadId = alreadyCreated.zohoLeadId
            ? String(alreadyCreated.zohoLeadId)
            : null;
        }
        continue;
      }

      // Build lead payload for this bidder
      const payload: Record<string, unknown> = {
        Last_Name: bidderCompany,
        Company: bidderCompany,
        Lead_Status: NEED_TO_QUOTE,
        Lead_Source: LEAD_SOURCE,
        [MAIL_FIRST_TAG_FIELD]: MAIL_FIRST_TAG_VALUE,
        ...(await this.leadOwnerField()),
      };

      payload["Email"] = bidderEmail;

      const finalAddress =
        email.proposed?.projectName?.trim() ||
        email.proposed?.jobAddress?.trim() ||
        null;
      if (finalAddress) {
        payload["Address"] = finalAddress;
        payload["Job_Address"] = finalAddress;
      }

      // Insert into Zoho (attempt)
      let zohoLeadId: string | null = null;
      try {
        const response =
          await this.zohoService.insertIntoZoho<ZohoInsertResponse>(LEADS_PATH, {
            data: [payload],
          });
        zohoLeadId = response.data?.[0]?.details?.id ?? null;
        if (zohoLeadId) createdZohoLeadIds.push(zohoLeadId);
      } catch (err) {
        console.warn(
          `[MailFirstService] Zoho insert failed for bidder ${bidderEmail} (${(err as Error)?.message ?? err}). Using local fallback.`,
        );
      }

      let bidderProjectId: string | null = null;

      if (zohoLeadId) {
        try {
          // Sync lead to create project with groupId
          await this.zohoSyncService.syncLeadById(
            zohoLeadId,
            "webhook",
            ProjectCreationSource.MAIL_FIRST,
            {
              groupId: groupId || undefined,
              isCompetitiveBid: true,
            },
          );

          for (let i = 0; i < 10; i++) {
            const existingProject = (await mongoose
              .model("Project")
              .findOne({ zohoLeadId })
              .lean()) as any;

            if (existingProject && existingProject._id) {
              const projectId = String(existingProject._id);
              bidderProjectId = projectId;
              createdProjectIds.push(projectId);

              // Update project with groupId and competitive bid flag
              await mongoose.model("Project").updateOne(
                { _id: existingProject._id },
                {
                  $set: {
                    groupId,
                    isCompetitiveBid: true,
                    creationSource: "MAIL_FIRST",
                  },
                },
              );

              if (bidderEmail === primaryBidderEmail || bidder.isPrimary) {
                primaryProjectId = projectId;
                primaryZohoLeadId = zohoLeadId;
              }

              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        } catch (err) {
          console.warn(
            `[MailFirstService] Zoho lead sync failed for bidder lead ${zohoLeadId}:`,
            (err as Error)?.message ?? err,
          );
        }
      }

      if (!bidderProjectId) {
        const bidderProjectName = `${email.proposed?.projectName || "Competitive Bid"} - ${bidderCompany}`;
        const created = await projectCreationService.create(
          {
            projectName: bidderProjectName,
            projectAddress:
              email.proposed?.jobAddress?.trim() ||
              email.proposed?.address?.trim() ||
              null,
            description:
              email.proposed?.summary?.trim() || email.bodyText?.trim() || null,
            receivedDate: email.receivedDateTime
              ? new Date(email.receivedDateTime)
              : new Date(),
            leadStatus: NEED_TO_QUOTE,
            groupId,
            isCompetitiveBid: true,
            client: {
              customerName: bidderCompany,
              customerEmail: bidderEmail,
              company: bidderCompany,
            },
          },
          {
            creationSource: ProjectCreationSource.MAIL_FIRST,
            zohoLeadId: zohoLeadId ?? undefined,
          },
        );
        bidderProjectId = String(created.id);
        createdProjectIds.push(bidderProjectId);
        if (bidderEmail === primaryBidderEmail || bidder.isPrimary) {
          primaryProjectId = bidderProjectId;
          primaryZohoLeadId = zohoLeadId;
        }
      }
    }

    if (createdProjectIds.length !== uniqueBidders.length) {
      throw new AppError(
        "Not all bidder projects were created",
        StatusCodes.BAD_GATEWAY,
      );
    }

    primaryProjectId ||= createdProjectIds[0] ?? null;
    primaryZohoLeadId ||= createdZohoLeadIds[0] ?? null;
    if (!primaryProjectId) {
      throw new AppError(
        "Primary bidder project was not created",
        StatusCodes.BAD_GATEWAY,
      );
    }

    // Link all projects together via relatedProjectIds
    if (createdProjectIds.length > 1) {
      for (const projectId of createdProjectIds) {
        const otherIds = createdProjectIds
          .filter((id) => id !== projectId)
          .map((id) => new mongoose.Types.ObjectId(id));

        await mongoose
          .model("Project")
          .updateOne(
            { _id: new mongoose.Types.ObjectId(projectId) },
            { $set: { relatedProjectIds: otherIds } },
          );
      }
    }

    const matchedDocumentIds = await this.linkCompetitiveDocuments(
      email,
      primaryProjectId,
    );

    // Confirm only after every bidder project exists and is linked. Until then the
    // draft stays retryable, avoiding a misleading successful approval state.
    await OutlookEmail.updateOne(
      { _id: email._id },
      {
        $set: {
          status: "CONFIRMED",
          projectId: new mongoose.Types.ObjectId(primaryProjectId),
          linkMethod: "AUTO",
        },
      },
    );

    // Trigger Stage 0 for primary project
    try {
      await proposalService.triggerStage0Extraction(
        primaryProjectId,
        matchedDocumentIds,
        {
          subject: email.subject ?? undefined,
          fromAddress: email.fromAddress ?? undefined,
          correlationId: `outlookEmail:${String(email._id)}`,
        },
      );
    } catch (err) {
      console.error(
        `Failed to trigger Stage 0 Extraction for competitive bid project ${primaryProjectId}`,
        err,
      );
    }

    return {
      zohoLeadId: primaryZohoLeadId,
      projectId: primaryProjectId,
      alreadyProcessed: false,
      allProjectIds: createdProjectIds,
    };
  }

  private async linkCompetitiveDocuments(
    email: IOutlookEmail,
    projectId: string,
  ): Promise<string[]> {
    const projectObjectId = new mongoose.Types.ObjectId(projectId);
    const storageKeys = (email.attachments ?? [])
      .map((attachment) => attachment.storageKey)
      .filter((key): key is string => Boolean(key && key !== "FOLDER_STAGED"));
    const matchFilter = {
      $or: [
        ...(storageKeys.length > 0
          ? [{ storageKey: { $in: storageKeys } }]
          : []),
        { "metadata.emailId": { $in: [email._id.toString(), email._id] } },
      ],
    };

    const documents = await mongoose
      .model("Document")
      .find(matchFilter, { _id: 1 })
      .lean();
    if (documents.length > 0) {
      await mongoose.model("Document").updateMany(matchFilter, {
        $set: {
          projectId: projectObjectId,
          status: "PROCESSED",
          isActive: true,
        },
      });
    }

    const project = await new MongooseProjectRepository().findById(projectId);
    if (project) {
      dropboxSyncService
        .outwardSync(project)
        .catch((err) =>
          console.error(
            `[MailFirstService] bidder outwardSync failed for project ${projectId}:`,
            err,
          ),
        );
    }

    return documents.map((document: any) => String(document._id));
  }

  public async rejectDraft(emailId: string): Promise<void> {
    const email = await OutlookEmail.findById(emailId);
    if (!email)
      throw new AppError("Draft email not found", StatusCodes.NOT_FOUND);
    if (email.status === "DISCARDED") return;
    if (email.status !== "DRAFT") {
      throw new AppError(
        `Cannot discard an email in status ${email.status}`,
        StatusCodes.CONFLICT,
      );
    }
    email.status = "DISCARDED";
    await email.save();
  }

  public async updateDraftProjectName(
    emailId: string,
    projectName: string,
  ): Promise<{ id: string; projectName: string }> {
    const email = await OutlookEmail.findById(emailId);
    if (!email)
      throw new AppError("Draft email not found", StatusCodes.NOT_FOUND);
    if (email.status !== "DRAFT") {
      throw new AppError(
        `Cannot edit a draft in status ${email.status}`,
        StatusCodes.CONFLICT,
      );
    }
    if (!email.proposed) {
      throw new AppError(
        "Email has no AI proposal to edit",
        StatusCodes.BAD_REQUEST,
      );
    }

    email.proposed.projectName = projectName;
    await email.save();

    return { id: email._id.toString(), projectName };
  }

  private async buildLeadPayload(email: IOutlookEmail): Promise<Record<string, unknown>> {
    const proposed = email.proposed;
    const customerName = proposed?.customerName?.trim() || null;
    const companyName = proposed?.companyName?.trim() || null;
    const senderName = email.fromName?.trim() || null;

    const lastName =
      customerName || senderName || email.fromAddress || "Mail Lead";

    // A contact person's name is not a safe company fallback. Keeping these
    // fields separate prevents sender names from being persisted as companies.
    const company = companyName || "Unknown";

    // The (possibly edited) project name is the single source of truth for this
    // lead's address. In the mail-first flow the project name IS the address and the
    // estimator can correct it before approval, so we write the same value to BOTH
    // Zoho `Address` and `Job_Address`. Sourcing `Address` separately from
    // proposed.jobAddress/address let the two fields diverge (Address kept the
    // original AI-extracted value while Job_Address got the edit), which surfaced as
    // two different addresses on the created project.
    const finalAddress =
      proposed?.projectName?.trim() ||
      proposed?.jobAddress?.trim() ||
      proposed?.address?.trim() ||
      null;

    const payload: Record<string, unknown> = {
      Last_Name: lastName,
      Company: company,
      Lead_Status: NEED_TO_QUOTE,
      Lead_Source: LEAD_SOURCE,
      [MAIL_FIRST_TAG_FIELD]: MAIL_FIRST_TAG_VALUE,
      ...(await this.leadOwnerField()),
    };
    if (email.fromAddress) payload["Email"] = email.fromAddress;
    if (finalAddress) {
      payload["Address"] = finalAddress;
      payload["Job_Address"] = finalAddress;
    }

    return payload;
  }

  public async listPendingDrafts(): Promise<any[]> {
    const drafts = await OutlookEmail.find({
      status: "DRAFT",
      proposed: { $exists: true, $ne: null },
    })
      .sort({ createdAt: -1 })
      .lean();

    const mappedDrafts = await Promise.all(
      drafts.map(async (draft) => {
        const attachmentsMap = new Map<string, any>();

        // Attachments carry only a name and an opaque storageKey. The Azure blob
        // URL and its SAS are deliberately NOT sent to the browser: the bytes are
        // streamed back through POST /drafts/:emailId/attachments/preview instead.
        // A browser fetch() of a SAS URL is also blocked outright, because the
        // storage account publishes no CORS rules.

        // 1. Map existing email attachments
        for (const att of draft.attachments || []) {
          const key = att.storageKey || att.name || "attachment";
          attachmentsMap.set(key, {
            name: att.name,
            storageKey: att.storageKey ?? null,
          });
        }

        // 2. Fetch and append staged cloud documents linked to this emailId
        try {
          const cloudDocs = await mongoose.model("Document").find({
            "metadata.emailId": String(draft._id),
            status: "STAGING",
          });

          for (const doc of cloudDocs) {
            const storageKey = doc.storageKey;
            if (storageKey && !attachmentsMap.has(storageKey)) {
              attachmentsMap.set(storageKey, {
                name: doc.originalName,
                storageKey,
              });
            }
          }
        } catch (err) {
          console.error(
            `Failed to fetch staged cloud documents for draft review of email ${draft._id}:`,
            err,
          );
        }

        return {
          id: draft._id.toString(),
          messageId: draft.messageId,
          subject: draft.subject,
          fromAddress: draft.fromAddress,
          fromName: draft.fromName,
          receivedDateTime: draft.receivedDateTime,
          proposed: draft.proposed,
          // Surface the AI-extracted job address at top level so the Draft Projects
          // view can show it to the sales manager before approval.
          address:
            draft.proposed?.jobAddress || draft.proposed?.address || null,
          attachments: Array.from(attachmentsMap.values()),
          bodyText: draft.bodyText,
          // Preserve the original structure for the sanitized draft-review renderer.
          bodyHtml: draft.bodyHtml ?? null,
        };
      }),
    );

    return mappedDrafts;
  }

  /**
   * Streams one draft attachment back through the API.
   *
   * The browser never receives the Azure blob URL or its SAS token. It asks for
   * an attachment by the opaque storageKey it was given in the drafts list, and
   * we verify that key genuinely belongs to that draft before streaming, so a
   * caller cannot read arbitrary blobs by guessing keys.
   */
  public async previewDraftAttachment(
    emailId: string,
    storageKey: string,
  ): Promise<{
    fileName: string;
    stream: NodeJS.ReadableStream;
    contentType?: string;
    contentLength?: number;
  }> {
    if (!mongoose.isValidObjectId(emailId)) {
      throw new AppError("Draft email not found", StatusCodes.NOT_FOUND);
    }
    if (!storageKey || storageKey === "FOLDER_STAGED") {
      throw new AppError("storageKey is required", StatusCodes.BAD_REQUEST);
    }

    const draft = await OutlookEmail.findById(emailId).lean();
    if (!draft) {
      throw new AppError("Draft email not found", StatusCodes.NOT_FOUND);
    }

    // The key must belong to this draft, either as an email attachment...
    let fileName = (draft.attachments || []).find(
      (att: any) => att.storageKey === storageKey,
    )?.name as string | undefined;

    // ...or as a cloud document staged against this same email.
    if (!fileName) {
      const stagedDoc = await mongoose
        .model("Document")
        .findOne({ "metadata.emailId": String(draft._id), storageKey })
        .lean();
      fileName = (stagedDoc as any)?.originalName;
    }

    if (!fileName) {
      throw new AppError(
        "Attachment not found on this draft",
        StatusCodes.NOT_FOUND,
      );
    }

    const file = await this.blobStorage.download(storageKey);
    return {
      fileName,
      stream: file.stream,
      ...(file.contentType ? { contentType: file.contentType } : {}),
      ...(file.contentLength !== undefined
        ? { contentLength: file.contentLength }
        : {}),
    };
  }

  public async linkDraftToProject(
    emailId: string,
    projectId: string,
  ): Promise<{ emailId: string; projectId: string }> {
    await outlookService.processAiResult({
      correlationId: `outlookEmail:${emailId}`,
      action: "LINK",
      projectId,
    });
    return { emailId, projectId };
  }
}
