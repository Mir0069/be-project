import mongoose from 'mongoose';

import { ProjectStatus, ProjectType } from '@db/models/project.model';
import { User } from '@db/models/user.model';
import { AppError } from '@shared/errors/app.error';
import type {
  ICreateProjectFields,
  IDomainProject,
  IProjectRepository,
} from '@repositories/interfaces/i-project.repository';
import type { ISequenceRepository } from '@repositories/interfaces/i-sequence.repository';
import type { IFileStorageRepository } from '@repositories/interfaces/i-file-storage.repository';
import type { IProjectParameterRepository } from '@repositories/interfaces/i-project-parameter.repository';
import { getDropboxAccessToken, createDropboxFolder, buildDropboxFolderPath } from '@shared/utils/dropbox';
import { env } from '@config/index';
import { dropboxSyncService } from '@features/projects/dropbox-sync.service';
import { normalizePhoneValue } from '@shared/utils/phone-values';
import type { IProjectTeamsMembership } from '@features/teams/teams-membership.port';
import { buildEstimatorAssignedEmail, type IMailerService } from '@shared/mailer';
import type { NotificationService } from '@features/notifications/notification.service';

import type {
  CreateProjectEstimator,
  CreateProjectInput,
  IProjectCreator,
  ProjectCreationOptions,
} from './project-creation.types';

const MAX_REFERENCE_NUMBER_ATTEMPTS = 5;

export class ProjectCreationService implements IProjectCreator {
  public constructor(
    private readonly projectRepository: IProjectRepository,
    private readonly sequenceRepository: ISequenceRepository,
    private readonly fileStorageRepository: IFileStorageRepository,
    private readonly projectParameterRepository: IProjectParameterRepository,
    private readonly teamsMembership?: IProjectTeamsMembership,
    private readonly mailerService?: IMailerService,
    private readonly notificationService?: NotificationService,
  ) { }

  public async create(input: CreateProjectInput, options: ProjectCreationOptions): Promise<IDomainProject> {
    if (!input.projectName || input.projectName.trim().length === 0) {
      throw new AppError('projectName is required', 400);
    }

    if (options.zohoLeadId) {
      const existing = await this.projectRepository.findByZohoLeadId(options.zohoLeadId);
      if (existing) return existing;
    }

    const customerName =
      input.client?.customerName?.trim() || input.client?.company?.trim() || input.projectName.trim();

    // Convert relatedProjectIds strings to ObjectIds if provided
    const relatedProjectObjectIds = input.relatedProjectIds && input.relatedProjectIds.length > 0
      ? input.relatedProjectIds
          .filter((id: string) => mongoose.isValidObjectId(id))
          .map((id: string) => new mongoose.Types.ObjectId(id))
      : undefined;

    const createFields: Omit<ICreateProjectFields, 'referenceNumber'> = {
      projectName: input.projectName.trim(),
      customerName,
      projectType: input.projectType ?? ProjectType.NEW_ESTIMATE,
      status: ProjectStatus.SETUP_PENDING,
      creationSource: options.creationSource,
      zohoLeadId: options.zohoLeadId ?? null,
      jobAddress: input.projectAddress ?? null,
      description: input.description ?? null,
      receivedDate: input.receivedDate ?? null,
      leadStatus: input.leadStatus ?? null,
      customerEmail: input.client?.customerEmail ?? null,
      customerPhone: normalizePhoneValue(input.client?.customerPhone),
      company: input.client?.company ?? null,
      customerWebsite: input.client?.website ?? null,
      address: input.address ?? null,
      assignedEstimators:
        input.estimator?.id && mongoose.isValidObjectId(input.estimator.id)
          ? [new mongoose.Types.ObjectId(input.estimator.id)]
          : undefined,
      isActive: true,
      groupId: input.groupId ?? null,
      isCompetitiveBid: input.isCompetitiveBid ?? false,
      relatedProjectIds: relatedProjectObjectIds,
    };

    let allocated: {
      referenceNumber: string;
      sequenceName: string;
      value: number;
    } | null = null;
    let project: IDomainProject | null = null;

    for (let attempt = 1; attempt <= MAX_REFERENCE_NUMBER_ATTEMPTS; attempt++) {
      // A reference number is required at insert time. Some legacy databases
      // have a sequence one or more values behind the existing Project rows.
      // On that specific collision, keep advancing the sequence rather than
      // releasing the colliding number back and retrying it forever.
      allocated = await this.generateReferenceNumber();

      try {
        project = await this.projectRepository.create({
          ...createFields,
          referenceNumber: allocated.referenceNumber,
        });
        break;
      } catch (err) {
        if (options.zohoLeadId && this.isDuplicateKeyError(err)) {
          const existing = await this.projectRepository.findByZohoLeadId(options.zohoLeadId);
          if (existing) {
            // The allocated number was not used by this request.
            await this.releaseReferenceNumber(allocated);
            return existing;
          }
        }

        if (this.isDuplicateReferenceNumberError(err) && attempt < MAX_REFERENCE_NUMBER_ATTEMPTS) {
          console.warn(`[ProjectCreation] reference ${allocated.referenceNumber} already exists; allocating a new reference`);
          continue;
        }

        // Do not release a colliding reference number: that would move the
        // sequence back to the already-used value and make every retry fail.
        if (!this.isDuplicateReferenceNumberError(err)) {
          await this.releaseReferenceNumber(allocated);
        }
        throw err;
      }
    }

    if (!project || !allocated) {
      throw new AppError('Unable to allocate a unique project reference number', 500);
    }

    // The project and its parameter row are ONE unit of work: a project whose
    // parameters are missing is half-created, and nothing later re-seeds them.
    // Mongo gives us no transaction here, so the pair is made atomic the other
    // way round — if the dependent write cannot be completed, the parent is
    // undone and the reference number handed back, leaving no partial record.
    try {
      await this.provisionParameters(project.id);
    } catch (err) {
      await this.projectRepository.deleteById(project.id);
      await this.releaseReferenceNumber(allocated);
      console.error(`[ProjectCreation] rolled back project ${project.id}: parameters could not be seeded`, err);
      throw err;
    }

    // Storage is deliberately NOT part of that unit. It is an external system,
    // blobStorageURL is nullable, and Dropbox is best-effort, so a storage
    // outage must not destroy a project the estimator can still work in.
    const created = await this.provisionStorage(project);

    if (options.assignedBy && input.estimator?.id) {
      await this.teamsMembership?.syncProject({ projectId: created.id, assignedBy: options.assignedBy });
    }

    if (created.assignedEstimators && created.assignedEstimators.length > 0) {
      await this.notifyAssignedEstimators(created, options, input.estimator);
    }

    return created;
  }

  private async notifyAssignedEstimators(
    project: IDomainProject,
    options: ProjectCreationOptions,
    inputEstimator?: CreateProjectEstimator | null,
  ): Promise<void> {
    const estimators = project.assignedEstimators ?? [];
    if (estimators.length === 0) return;

    let assignedByName: string | null = null;
    if (options.assignedBy && mongoose.isValidObjectId(options.assignedBy)) {
      try {
        const assigner = await User.findById(options.assignedBy).select('firstName lastName').lean();
        if (assigner) {
          assignedByName = `${assigner.firstName} ${assigner.lastName}`.trim() || null;
        }
      } catch (err) {
        console.warn('[ProjectCreation] Failed to resolve assigner name:', err);
      }
    }

    // 1. In-app notification
    if (this.notificationService) {
      try {
        await this.notificationService.notifyEstimatorAssigned({
          projectId: project.id,
          referenceNumber: project.referenceNumber,
          projectName: project.projectName ?? null,
          estimators: estimators.map((e) => ({
            id: e.id,
            name: e.name ?? null,
            ...(e.email ? { email: e.email.trim() } : {}),
          })),
          assignedByName,
          ...(this.mailerService ? { sendEmail: false } : {}),
        });
      } catch (err) {
        console.error('[ProjectCreation] Failed to emit notifyEstimatorAssigned:', err);
      }
    }

    // 2. Email notification via mailerService
    if (!this.mailerService) return;

    for (const estimator of estimators) {
      try {
        let recipientEmail: string | undefined = estimator.email?.trim();
        let recipientName: string | null | undefined = estimator.name?.trim() || null;

        if (!recipientEmail && estimator.id === inputEstimator?.id && inputEstimator?.email) {
          recipientEmail = inputEstimator.email.trim();
        }

        if (!recipientEmail && mongoose.isValidObjectId(estimator.id)) {
          const user = await User.findById(estimator.id).select('email firstName lastName').lean();
          if (user?.email) {
            recipientEmail = user.email.trim();
            if (!recipientName) {
              recipientName = `${user.firstName} ${user.lastName}`.trim() || null;
            }
          }
        }

        if (!recipientEmail) {
          console.warn(`[ProjectCreation] Skipping assignment email: no email found for estimator ${estimator.id}`);
          continue;
        }

        const projectUrl = `${env.app.frontendUrl}/projects/${project.id}`;
        const emailInput = {
          to: recipientEmail,
          recipientName,
          referenceNumber: project.referenceNumber,
          projectName: project.projectName,
          customerName: project.customerName,
          company: project.company,
          projectType: project.projectType,
          dueDate: project.dueDate,
          jobAddress: project.jobAddress,
          projectUrl,
          assignedByName,
        };

        if (typeof this.mailerService.sendEstimatorAssignedNotification === 'function') {
          await this.mailerService.sendEstimatorAssignedNotification(emailInput);
        } else {
          const { subject, text, html } = buildEstimatorAssignedEmail(emailInput);
          await this.mailerService.sendMail({ to: recipientEmail, subject, text, html });
        }

        console.log(`[ProjectCreation] Assignment email sent to ${recipientEmail} for project ${project.referenceNumber}`);
      } catch (err) {
        console.error(`[ProjectCreation] Failed to send assignment email to estimator ${estimator.id}:`, err);
      }
    }
  }

  /**
   * Returns an unused reference number to its sequence. Best-effort by design:
   * under concurrency the counter may already have moved past it, in which case
   * the number simply stays spent rather than being reissued to two projects.
   */
  private async releaseReferenceNumber(allocated: { sequenceName: string; value: number }): Promise<void> {
    try {
      const reclaimed = await this.sequenceRepository.releaseSequenceValue(allocated.sequenceName, allocated.value);
      if (!reclaimed) {
        console.warn(`[ProjectCreation] reference ${allocated.sequenceName}-${allocated.value} not reclaimed (sequence moved on)`);
      }
    } catch (err) {
      console.error('[ProjectCreation] failed to release reference number:', err);
    }
  }

  private async generateReferenceNumber(): Promise<{ referenceNumber: string; sequenceName: string; value: number }> {
    const year = new Date().getFullYear();
    const sequenceName = `GFS-${year}`;
    const nextVal = await this.sequenceRepository.getNextSequenceValue(sequenceName);
    // Project references intentionally start at 1001 and are not zero-padded.
    return { referenceNumber: `${sequenceName}-${nextVal.toString()}`, sequenceName, value: nextVal };
  }

  /**
   * Seeds the project's parameter row. THROWS on failure, deliberately: this is
   * a dependent write, and swallowing the error is what used to leave a project
   * committed without one. Idempotent, so a retry or a racing caller is a no-op
   * rather than a duplicate-key failure.
   */
  private async provisionParameters(projectId: string): Promise<void> {
    await this.projectParameterRepository.ensureForProject(projectId);
  }

  private async provisionStorage(project: IDomainProject): Promise<IDomainProject> {
    // ── Azure Blob Storage ───────────────────────────────────────────────────
    let updated: IDomainProject | null = null;
    try {
      const basePath = this.fileStorageRepository.getProjectRootPath(project.id);
      await this.fileStorageRepository.createFolderStructure(basePath, ['documents', 'drawings', 'proposals']);
      updated = await this.projectRepository.updateById(project.id, { blobStorageURL: `${basePath}/` });
    } catch (err) {
      console.error(`[ProjectCreation] Azure storage provisioning failed for ${project.id}:`, err);
    }

    // Skip live Dropbox calls only during automated Jest test runner execution
    if (process.env['JEST_WORKER_ID'] !== undefined || process.env['npm_lifecycle_event'] === 'test') {
      return project;
    }

    try {
      const rootPath = buildDropboxFolderPath(project.projectName, project.referenceNumber);
      const token = await getDropboxAccessToken({
        clientId: env.dropbox.clientId,
        clientSecret: env.dropbox.clientSecret,
        refreshToken: env.dropbox.refreshToken,
        accessToken: env.dropbox.accessToken,
      });

      // Step 1: ensure the GFS root folder exists in Dropbox (idempotent — 409 is silently ignored)
      await createDropboxFolder(env.dropbox.rootPath, token);

      // Step 2: create the project folder + 3 subfolders
      await createDropboxFolder(rootPath, token);
      await createDropboxFolder(`${rootPath}/Customer Provided Info & Project drawings`, token);
      await createDropboxFolder(`${rootPath}/Worksheets and quotes`, token);
      await createDropboxFolder(`${rootPath}/Telephone Transcripts`, token);

      updated = await this.projectRepository.updateById(project.id, { dropboxFolderPath: rootPath }) ?? updated;
      console.log(`[ProjectCreation] Dropbox folder created: ${rootPath}`);

      const estimatorIds = (project.assignedEstimators ?? []).map(
        (e: any) => (typeof e === 'string' ? e : e?.id ?? e?._id?.toString())
      ).filter(Boolean);
      await this.notificationService?.notifyDropboxWorkspaceCreated({
        projectId: project.id,
        referenceNumber: project.referenceNumber,
        projectName: project.projectName,
        folderPath: rootPath,
        estimatorIds,
      });

      // Immediate outward sync — push any pre-existing documents (e.g. email attachments)
      if (updated) {
        dropboxSyncService.outwardSync(updated).catch((err: any) =>
          console.error(`[ProjectCreation] immediate outwardSync failed for ${project.id}:`, err)
        );
      }
    } catch (err) {
      // Non-fatal: project still created even if Dropbox provisioning fails
      console.error(`[ProjectCreation] Dropbox provisioning failed for ${project.id}:`, err);
    }

    return updated ?? project;
  }

  private isDuplicateKeyError(err: unknown): boolean {
    return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
  }

  private isDuplicateReferenceNumberError(err: unknown): boolean {
    if (!this.isDuplicateKeyError(err)) return false;
    const duplicate = err as {
      keyPattern?: Record<string, unknown>;
      keyValue?: Record<string, unknown>;
      message?: string;
    };
    return Boolean(
      duplicate.keyPattern?.['referenceNumber'] ||
      duplicate.keyValue?.['referenceNumber'] ||
      /referenceNumber(?:_1)?/i.test(String(duplicate.message ?? '')),
    );
  }
}
