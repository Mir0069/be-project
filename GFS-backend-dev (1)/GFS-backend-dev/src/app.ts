import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import morgan from 'morgan';
import mongoose from 'mongoose';


import { env } from '@config/index';
import { errorMiddleware } from '@shared/middleware/error.middleware';
import authRouter from '@features/auth/auth.router';
import usersRouter from '@features/users/users.router';
import zohoRouter from '@features/zoho/zoho.router';
import teamsRouter from '@features/teams/teams.router';
import outlookRouter from '@features/outlook/outlook.router';
import phoneTranscriptRouter from '@features/phone-transcript/phone-transcript.router';
import documentIngestionRouter from '@features/document-ingestion/document-ingestion.router';
import { projectWorkspaceRouter } from '@features/project-workspace/project-workspace.router'
import { proposalRouter } from '@features/proposal/proposal.router';
import { pendingApprovalRouter } from '@features/proposal/pending-approval.router';
import { aiExtractionResultRouter } from '@features/proposal/webhooks/ai-extraction-result.router';
import { excelTemplateRouter } from '@features/excel-template/excel-template.router';
import notificationRouter from '@features/notifications/notification.router';
import projectCreationRouter from '@features/project-creation/project-creation.router';
import mailFirstRouter from '@features/mail-first/mail-first.router';
import projectsRouter from '@features/projects/projects.router';
import statusReportRouter from '@features/status-report/status-report.router';
import auditLogsRouter from '@features/audit-logs/audit-logs.router';
import { auditRequestMiddleware } from '@shared/middleware/audit-request.middleware';

const app = express();

app.set('trust proxy', 1);
app.use(helmet());
app.use(
  cors({
    origin: (origin, callback) => {
      if (
        !origin ||
        env.app.nodeEnv !== 'production' ||
        origin === env.app.frontendUrl ||
        origin.endsWith('.azurecontainerapps.io')
      ) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  }),
);
app.use(compression());
// 2mb, not the 100kb body-parser default: the AI posts the whole canonical
// proposal schema back on every stage run (~165kb today, and it grows with the
// unit count and citations), which was failing with PayloadTooLargeError.
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(cookieParser());
app.use(morgan(env.app.nodeEnv === 'production' ? 'combined' : 'dev'));
// Capture authenticated state-changing requests after route authentication has
// populated req.user. The finish listener is best-effort and never blocks the
// business request.
app.use(auditRequestMiddleware);
app.use(
  rateLimit({
    windowMs: env.rateLimit.windowMs,
    max: env.rateLimit.maxRequests,
    standardHeaders: true,
    legacyHeaders: false,

    skip: (req) =>
      req.path === '/health' ||
      env.app.nodeEnv !== 'production' ||
      req.path.startsWith('/api/v1/zoho/') ||
      req.path.includes('/webhooks/ai-stage-result') ||
      req.path.includes('/webhooks/ai-extraction-result'),
  }),
);

app.get('/health', async (_req, res) => {
  try {
    const adminDb = mongoose.connection.db?.admin();
    const dbs = adminDb ? await adminDb.listDatabases() : null;
    const collections = await mongoose.connection.db?.listCollections().toArray();
    const userCount = await mongoose.model('User').countDocuments();
    const emails = await mongoose.model('User').find({}, { email: 1 }).limit(10);
    let storageInfo: any = null;
    try {
      const conn = process.env['AZURE_STORAGE_CONNECTION_STRING'];
      if (conn) {
        const { BlobServiceClient } = require('@azure/storage-blob');
        const client = BlobServiceClient.fromConnectionString(conn);
        const containers: string[] = [];
        for await (const c of client.listContainers()) {
          containers.push(c.name);
        }
        storageInfo = { accountName: client.accountName, containers };
      }
    } catch (e: any) {
      storageInfo = { error: e.message };
    }

    res.json({
      status: 'ok',
      db: mongoose.connection.name,
      host: mongoose.connection.host,
      dbs: dbs?.databases?.map((d: any) => d.name),
      collections: collections?.map((c: any) => c.name),
      userCount,
      emails: emails.map((e: any) => e.email),
      storageInfo,
    });
  } catch (err: any) {
    res.json({ status: 'error', error: err.message, db: mongoose.connection?.name, host: mongoose.connection?.host });
  }
});

app.use(`/api/${env.app.apiVersion}/auth`, authRouter);
app.use(`/api/${env.app.apiVersion}/users`, usersRouter);
app.use(`/api/${env.app.apiVersion}/zoho`, zohoRouter);
app.use('/zoho', zohoRouter);
app.use('/api/zoho', zohoRouter);
app.get('/callback', (req, res) => {
  const query = new URLSearchParams(req.query as any).toString();
  res.redirect(`/api/${env.app.apiVersion}/zoho/callback${query ? '?' + query : ''}`);
});
app.use(`/api/${env.app.apiVersion}/teams`, teamsRouter);
app.use(`/api/${env.app.apiVersion}/projects`, projectsRouter);
app.use(`/api/${env.app.apiVersion}/audit-logs`, auditLogsRouter);
app.use(`/api/${env.app.apiVersion}/reports`, statusReportRouter);
app.use(`/api/${env.app.apiVersion}/projects/:projectId/call-records`, phoneTranscriptRouter);
app.use(`/api/${env.app.apiVersion}`, documentIngestionRouter);
app.use(`/api/${env.app.apiVersion}/outlook`, outlookRouter);

app.use(`/api/${env.app.apiVersion}/proposals`, proposalRouter);
app.use(`/api/${env.app.apiVersion}`, pendingApprovalRouter);
app.use(`/api/${env.app.apiVersion}/webhooks`, aiExtractionResultRouter);
// NOTE: features/zoho/crm-context-webhook.router is deliberately NOT mounted.
// It is an unauthenticated PUT that overwrites a project's description by id,
// and `description` already comes from Zoho through the sync, so mounting it
// would expose a write for data we already own. Give it a shared secret before
// turning it on.
// Admin — upload master Excel template
app.use(`/api/${env.app.apiVersion}/excel-templates`, excelTemplateRouter);
app.use(`/api/${env.app.apiVersion}/project-workspace`, projectWorkspaceRouter);
app.use(`/api/${env.app.apiVersion}/notifications`, notificationRouter);
app.use(`/api/${env.app.apiVersion}/projects`, projectCreationRouter);
app.use(`/api/${env.app.apiVersion}/mail-first`, mailFirstRouter);

app.use(errorMiddleware);

export { app };

