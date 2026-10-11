import { Router } from 'express';
import multer from 'multer';
import { authenticate } from '@features/auth/auth.middleware';
import { asyncHandler } from '@shared/utils/async-handler';
import { createQueueAdapter } from '@shared/queues/queue.factory';

import { MongooseDocumentRepository } from '@repositories/mongoose/document.repository';
import { MongooseTeamsMonitoredChannelRepository } from '@repositories/mongoose/teams-monitored-channel.repository';
import { RoleBasedPermissionService } from './permission.service';
import { DocumentIngestionController } from './document-ingestion.controller';
import { 
  DocumentIngestionPipeline, 
  AzureContentAddressedBlobStorage, 
} from './document-ingestion.service';
import { persistentAuditLogger } from '@features/audit-logs/audit-logs.logger';

import os from 'os';
import path from 'path';
import fs from 'fs';

// Temporary upload directory for streaming Multer uploads to disk
const tempUploadDir = path.join(os.tmpdir(), 'gfs-uploads');
if (!fs.existsSync(tempUploadDir)) {
  fs.mkdirSync(tempUploadDir, { recursive: true });
}

// Multer disk storage setup (250 MB limit on file size) with zero heap buffer overhead
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, tempUploadDir),
    filename: (_req, file, cb) => {
      const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      cb(null, `${uniqueSuffix}-${file.originalname}`);
    },
  }),
  limits: { files: 1, fileSize: 250 * 1024 * 1024 },
});

const documentRepository = new MongooseDocumentRepository();
const teamsChannelRepository = new MongooseTeamsMonitoredChannelRepository();
const permissionService = new RoleBasedPermissionService();
const auditLogger = persistentAuditLogger;

export const blobStorage = new AzureContentAddressedBlobStorage({
  connectionString: process.env['AZURE_STORAGE_CONNECTION_STRING'],
  containerName: process.env['AZURE_STORAGE_CONTAINER_NAME'] || 'documents',
});

const aiQueue = createQueueAdapter(
  process.env['AZURE_SERVICE_BUS_AI_QUEUE_NAME'] || 'ai-ocr-ingestion'
);

// const serviceBusQueue = new AzureServiceBusQueue(
//   process.env['AZURE_SERVICE_BUS_CONNECTION_STRING'] || '',
//   process.env['AZURE_SERVICE_BUS_AI_QUEUE_NAME'] || 'ai-ocr-ingestion',
//   process.env['AZURE_SERVICE_BUS_DLQ_NAME'] || 'ai-ocr-ingestion-dlq'
// );

export const documentIngestionPipeline = new DocumentIngestionPipeline({
  repository: documentRepository,
  storage: blobStorage,
  queue: aiQueue,
  permissions: permissionService,
  audit: auditLogger,
  // Surface a shared Teams channel's documents in every linked project's list.
  linkedChannelResolver: async (projectId) => {
    const channels = await teamsChannelRepository.listByProjectId(projectId);
    return [...new Set(channels.map((c) => c.channelId))];
  },
  // Fired once per upload() call with the IDs of every document just created
  // (archive + zip children included). Dynamic import keeps
  // document-ingestion.service.ts itself free of a static dependency on
  // @features/proposal — only this bootstrap file needs to know
  onDocumentIngested: async (projectId, documentIds) => {
    try {
      const { projectRepository, documentRepository, notificationRepository } = require('../../repositories/index');
      const { NotificationService } = require('../notifications/notification.service');
      const { proposalService } = require('../proposal/proposal.router');
      
      // The one caller that may skip: nothing but the files changed, so if every
      // one of them already has a cached AI result there is nothing new to read.
      await proposalService.triggerStage0Extraction(
        projectId,
        documentIds,
        { correlationId: `doc:${documentIds[0]}` },
        { skipIfAllCached: true },
      );

      const [proj, docs] = await Promise.all([
        projectRepository.findById(projectId),
        Promise.all(documentIds.map((id: string) => documentRepository.findById(id))),
      ]);
      
      if (proj) {
        const fileNames = docs.filter(Boolean).map((d: any) => d.originalName);
        if (fileNames.length > 0) {
          const notificationService = new NotificationService(notificationRepository);
          const estimatorIds = (proj.assignedEstimators ?? [])
            .map((est: any) => (est && typeof est === 'object' ? (est._id || est.id) : est))
            .filter(Boolean)
            .map((id: any) => id.toString())
            .filter((id: string) => require('mongoose').Types.ObjectId.isValid(id));
          await notificationService.notifyDocumentAdded({
            projectId,
            referenceNumber: proj.referenceNumber,
            projectName: proj.projectName,
            fileNames,
            estimatorIds,
          });
        }
      }
    } catch (err) {
      console.error('[DocumentIngestion] failed to trigger document added notification / stage 0 extraction', err);
    }
  },
});

const controller = new DocumentIngestionController(documentIngestionPipeline);

const router = Router({ mergeParams: true });

router.post(
  '/projects/:projectId/documents',
  authenticate,
  upload.single('file'),
  asyncHandler((req, res) => controller.upload(req, res))
);

router.get(
  '/projects/:projectId/documents',
  authenticate,
  asyncHandler((req, res) => controller.list(req, res))
);

router.patch(
  '/documents/:documentId/final-input',
  authenticate,
  asyncHandler((req, res) => controller.markAsFinalInput(req, res))
);

router.get(
  '/documents/:documentId/download-url',
  authenticate,
  asyncHandler((req, res) => controller.createDownloadUrl(req, res))
);

router.get(
  '/documents/:documentId/view',
  authenticate,
  asyncHandler((req, res) => controller.viewDocument(req, res))
);

router.post(
  '/documents/preview',
  authenticate,
  asyncHandler((req, res) => controller.download(req, res)),
);

router.get(
  '/documents/storage-diagnostics',
  authenticate,
  asyncHandler(async (_req, res) => {
    const info: any = {
      configuredContainer: (blobStorage as any).containerName,
      accountUrl: (blobStorage as any).serviceClient?.url || null,
      containers: [],
      error: null,
    };
    try {
      if ((blobStorage as any).serviceClient) {
        for await (const c of (blobStorage as any).serviceClient.listContainers()) {
          info.containers.push(c.name);
        }
      }
    } catch (err: any) {
      info.error = err?.message || String(err);
    }
    res.status(200).json({ success: true, data: info });
  })
);

router.delete(
  '/documents/:documentId',
  authenticate,
  asyncHandler((req, res) => controller.delete(req, res))
);

router.post(
  '/documents/:documentId/restore',
  authenticate,
  asyncHandler((req, res) => controller.restore(req, res))
);

router.post(
  '/projects/:projectId/documents/move',
  authenticate,
  asyncHandler((req, res) => controller.moveDocuments(req, res))
);

router.post(
  '/documents/:documentId/move',
  authenticate,
  asyncHandler((req, res) => controller.moveDocuments(req, res))
);

export default router;
