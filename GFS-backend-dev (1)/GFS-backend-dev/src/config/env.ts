import path from 'path';
import dotenv from 'dotenv';

const envFile = process.env['ENV_FILE'] ? path.resolve(process.cwd(), process.env['ENV_FILE']) : undefined;
dotenv.config({ path: envFile, override: true });

const requireEnv = (key: string): string => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
};

const optionalEnv = (key: string, fallback: string): string => {
  const raw = process.env[key];
  // Treat an empty / whitespace-only value the same as unset so the fallback
  // applies. Using `??` alone let an env var that is present-but-empty (e.g.
  // TEAMS_AI_DISPATCH_ENABLED="") slip past the default and silently read as a
  // wrong value — e.g. `"" === 'true'` → false, which disabled AI dispatch and
  // left no Teams summaries.
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  return raw;
};

const requireInterval = (key: string): number => {
  const raw = requireEnv(key);
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed)) {
    throw new Error(`Environment variable ${key} (${raw}) must be a valid number`);
  }
  return parsed;
};

const optionalInterval = (key: string, fallback: number): number => {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed)) {
    console.warn(`[Config] ${key} (${raw}) is invalid. Enforcing fallback of ${fallback}ms.`);
    return fallback;
  }
  return parsed;
};

const optionalBcryptRounds = (key: string, fallback: number): number => {
  const parsed = parseInt(optionalEnv(key, String(fallback)), 10);
  if (isNaN(parsed)) return fallback;
  return Math.min(15, Math.max(10, parsed));
};

export const env = {
  app: {
    nodeEnv: optionalEnv('NODE_ENV', 'development'),
    port: parseInt(optionalEnv('PORT', '3000'), 10),
    apiVersion: optionalEnv('API_VERSION', 'v1'),
    baseUrl: optionalEnv('APP_BASE_URL', 'https://api.gfs.amberview.ai'),
    frontendUrl: optionalEnv('FRONTEND_URL', 'https://gfs.amberview.ai'),
  },
  auth: {
    jwtSecret: requireEnv('JWT_SECRET'),
    jwtExpiresIn: optionalEnv('JWT_ACCESS_EXPIRES_IN', '15m'),
    jwtRefreshSecret: requireEnv('JWT_REFRESH_SECRET'),
    jwtRefreshExpiresIn: optionalEnv('JWT_REFRESH_EXPIRES_IN', '7d'),
    bcryptSaltRounds: optionalBcryptRounds('BCRYPT_SALT_ROUNDS', 12),
    oauth: {
      googleClientId: optionalEnv('GOOGLE_CLIENT_ID', ''),
      googleClientSecret: optionalEnv('GOOGLE_CLIENT_SECRET', ''),
      microsoftClientId: optionalEnv('MICROSOFT_CLIENT_ID', ''),
      microsoftClientSecret: optionalEnv('MICROSOFT_CLIENT_SECRET', ''),
      microsoftTenantId: optionalEnv('MICROSOFT_TENANT_ID', 'common'),
      microsoftRedirectUri: optionalEnv(
        'MICROSOFT_REDIRECT_URI',
        'https://api.gfs.amberview.ai/api/v1/auth/oauth/microsoft/callback',
      ),
    },
  },
  db: {
    mongoUri: requireEnv('MONGODB_URI'),
  },
  rateLimit: {
    windowMs: parseInt(optionalEnv('RATE_LIMIT_WINDOW_MS', '900000'), 10),
    maxRequests: parseInt(optionalEnv('RATE_LIMIT_MAX_REQUESTS', '100'), 10),
    loginWindowMs: parseInt(optionalEnv('AUTH_LOGIN_RATE_LIMIT_WINDOW_MS', '900000'), 10),
    loginMaxAttempts: parseInt(optionalEnv('AUTH_LOGIN_RATE_LIMIT_MAX_ATTEMPTS', '10'), 10),
    forgotPasswordWindowMs: parseInt(optionalEnv('AUTH_FORGOT_PASSWORD_RATE_LIMIT_WINDOW_MS', '900000'), 10),
    forgotPasswordMaxAttempts: parseInt(optionalEnv('AUTH_FORGOT_PASSWORD_RATE_LIMIT_MAX_ATTEMPTS', '5'), 10),
  },
  logging: {
    level: optionalEnv('LOG_LEVEL', 'debug'),
  },
  zoho: {
    clientId: requireEnv('ZOHO_CLIENT_ID'),
    clientSecret: requireEnv('ZOHO_CLIENT_SECRET'),
    redirectUri: requireEnv('ZOHO_REDIRECT_URI'),
    apiDomain: optionalEnv('ZOHO_API_DOMAIN', 'https://www.zohoapis.in'),
    accountsUrl: optionalEnv('ZOHO_ACCOUNTS_URL', 'https://accounts.zoho.in'),
    useSandbox: optionalEnv('ZOHO_USE_SANDBOX', 'false').toLowerCase() === 'true',
    // Who owns the leads we create from mail. Accepts the person's Zoho login
    // email (resolved to a user id at run time) or a raw Zoho user id. Zoho
    // otherwise assigns the owner to whichever account authorized our OAuth
    // connection, which is a service account, not the person who has to follow
    // the lead up. Leave empty to keep that old behaviour.
    defaultLeadOwner: optionalEnv('ZOHO_DEFAULT_LEAD_OWNER', ''),
    scopes: optionalEnv(
      'ZOHO_SCOPES',
      'ZohoCRM.modules.ALL,ZohoCRM.users.READ,ZohoCRM.org.READ',
    ),
    // Pull-based sync (polling). Now OFF by default — webhook delivery is set
    // up, so we rely on push. Set ZOHO_POLLING_ENABLED=true to re-enable (e.g.
    // as a production reconciliation safety net alongside webhooks).
    pollingEnabled: optionalEnv('ZOHO_POLLING_ENABLED', 'false').toLowerCase() === 'true',
    pollIntervalMs: optionalInterval('ZOHO_POLL_INTERVAL_MS', 900000), // 15 min
    // On startup, the first poll sweeps this far back to catch anything that
    // changed while the server was off (so a restart never misses downtime
    // changes). Default 12h — bump it if the server is ever off longer.
    pollCatchupMs: parseInt(optionalEnv('ZOHO_POLL_CATCHUP_MS', '43200000'), 10), // 12 h
  },
  proposalApproval: {
    // Proposals priced at or below this may be approved by any active Sales
    // Manager. Above it, only the accounts in highValueApproverEmails may.
    highValueThreshold: optionalInterval('PROPOSAL_HIGH_VALUE_APPROVAL_THRESHOLD', 50000),
    highValueApproverEmails: optionalEnv(
      'PROPOSAL_HIGH_VALUE_APPROVER_EMAILS',
      'greg@glassflooringsystems.com,greg@gfs.com,wayne@glassflooringsystems.com',
    )
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  },
  teams: {
    // App-only (client-credentials) credentials. optionalEnv so the app still
    // boots for teammates without Teams creds; the token service validates
    // presence lazily and fails with a clear error only when Teams is used.
    // Teams ingestion uses Microsoft Graph app-only (client-credentials) auth
    // via its own dedicated Azure app, separate from the Outlook app. It
    // requires the Team/Channel/Files/Transcript application permissions with
    // admin consent. Fully decoupled from OUTLOOK_*/MICROSOFT_*; the token
    // service validates presence lazily and fails clearly when Teams is used.
    clientId: optionalEnv('TEAMS_CLIENT_ID', ''),
    clientSecret: optionalEnv('TEAMS_CLIENT_SECRET', ''),
    tenantId: optionalEnv('TEAMS_TENANT_ID', ''),
    authority: optionalEnv('TEAMS_AUTHORITY', 'https://login.microsoftonline.com'),
    graphBaseUrl: optionalEnv('TEAMS_GRAPH_BASE_URL', 'https://graph.microsoft.com/v1.0'),
    scope: optionalEnv('TEAMS_SCOPE', 'https://graph.microsoft.com/.default'),
    // Sole Teams sync cadence (webhook removed). REQUIRED from env — no code
    // default; the duration is decided entirely by TEAMS_POLL_INTERVAL_MS
    // (.env locally / BACKEND_ENV + the ci.yml allowlist in prod). requireEnv
    // throws on a missing OR empty value, so a misconfigured deploy fails loudly
    // at boot rather than silently running a bad interval.
    pollIntervalMs: requireInterval('TEAMS_POLL_INTERVAL_MS'),
    // On by default: the poller is the only Teams sync driver.
    // Safe with no monitored channels (syncAll loops over an empty list).
    pollingEnabled: optionalEnv('TEAMS_POLLING_ENABLED', 'true').toLowerCase() === 'true',
    fileIngestEnabled: optionalEnv('TEAMS_FILE_INGEST_ENABLED', 'true').toLowerCase() === 'true',
    transcriptIngestEnabled:
      optionalEnv('TEAMS_TRANSCRIPT_INGEST_ENABLED', 'true').toLowerCase() === 'true',
    // Push (Graph change notifications). Off by default so environments without
    // a public HTTPS endpoint / creds don't try to create subscriptions.
    webhookEnabled: optionalEnv('TEAMS_WEBHOOK_ENABLED', 'false').toLowerCase() === 'true',
    // Public HTTPS base Graph posts notifications to (the deployed backend,
    // e.g. https://api.gfs.amberview.ai). notificationUrl = base + webhook path.
    webhookBaseUrl: optionalEnv('TEAMS_WEBHOOK_BASE_URL', ''),
    // Secret echoed by Graph in every notification; verified on receipt.
    webhookClientState: optionalEnv('TEAMS_WEBHOOK_CLIENT_STATE', ''),
    // Graph caps channel-message subscriptions near 60 min; request ~55 min.
    subscriptionTtlMs: optionalInterval('TEAMS_SUBSCRIPTION_TTL_MS', 3300000),
    // Renew when a subscription is within this window of expiry.
    subscriptionRenewBeforeMs: optionalInterval('TEAMS_SUBSCRIPTION_RENEW_BEFORE_MS', 900000),
    // 5-minute renewal/reconcile cron (product cadence; no hourly jobs).
    subscriptionCronIntervalMs: optionalInterval('TEAMS_SUBSCRIPTION_CRON_INTERVAL_MS', 300000),
    // First post-boot poll widens the transcript backfill to recover meeting
    // transcripts generated during downtime.
    pollCatchupMs: parseInt(optionalEnv('TEAMS_POLL_CATCHUP_MS', '43200000'), 10),
    // Send synced Teams content (chat batches + meetings) to the AI queue.
    // ON by default — ONLY an explicit "false" disables it. Any other value
    // (unset, empty, or anything non-"false") keeps dispatch enabled, so a
    // misconfigured env can never again silently break Teams AI summaries.
    aiDispatchEnabled:
      optionalEnv('TEAMS_AI_DISPATCH_ENABLED', 'true').toLowerCase() !== 'false',
    // ---- Auto-provisioning: create a private Team + channel when a project is
    // created (Zoho-first / mail-first). OFF by default. Retries run on the Teams
    // poller, so TEAMS_POLLING_ENABLED must stay true for the retry safety-net.
    autoProvisionEnabled:
      optionalEnv('TEAMS_AUTO_PROVISION_ENABLED', 'false').toLowerCase() === 'true',
    // The licensed M365 account that owns every auto-created team (app-only
    // creation requires a real user owner; the app itself can't own a team).
    // Prefer the GUID; a bare UPN is resolved to a GUID once at runtime.
    ownerGuid: optionalEnv('TEAMS_OWNER_GUID', ''),
    ownerUpn: optionalEnv('TEAMS_OWNER_UPN', ''),
    // Adds assigned estimators, the assigning sales manager and every Head of Division
    // to each project's team. ON by default — only an explicit "false" disables it.
    autoAddMembersEnabled:
      optionalEnv('TEAMS_AUTO_ADD_MEMBERS_ENABLED', 'true').toLowerCase() !== 'false',
  },
  outlook: {
    // Outlook mail ingestion uses Microsoft Graph app-only (client-credentials)
    // auth via its own dedicated Azure app, separate from the Teams app. It
    // requires the Mail.Read / Mail.ReadWrite application permissions with admin
    // consent. Kept fully decoupled from TEAMS_* so a missing OUTLOOK_* fails
    // loudly instead of silently borrowing the Teams app (which lacks mail
    // permissions). The token service validates presence lazily.
    clientId: optionalEnv('OUTLOOK_CLIENT_ID', ''),
    clientSecret: optionalEnv('OUTLOOK_CLIENT_SECRET', ''),
    tenantId: optionalEnv('OUTLOOK_TENANT_ID', ''),
    authority: optionalEnv('OUTLOOK_AUTHORITY', 'https://login.microsoftonline.com'),
    graphBaseUrl: optionalEnv('OUTLOOK_GRAPH_BASE_URL', 'https://graph.microsoft.com/v1.0'),
    scope: optionalEnv('OUTLOOK_SCOPE', 'https://graph.microsoft.com/.default'),
    pollIntervalMs: optionalInterval('OUTLOOK_POLL_INTERVAL_MS', 10000),
    pollingEnabled: optionalEnv('OUTLOOK_POLLING_ENABLED', 'false').toLowerCase() === 'true',
    fileIngestEnabled:
      optionalEnv('OUTLOOK_FILE_INGEST_ENABLED', 'true').toLowerCase() === 'true',
    emailIngestEnabled:
      optionalEnv('OUTLOOK_EMAIL_INGEST_ENABLED', 'true').toLowerCase() === 'true',
    // Delete the message from the mailbox after it is fully ingested. Requires
    // the app to have Mail.ReadWrite (Mail.Read alone cannot delete).
    deleteAfterIngest:
      optionalEnv('OUTLOOK_DELETE_AFTER_INGEST', 'false').toLowerCase() === 'true',
    // The central mailbox to monitor. When set, it is auto-registered on startup
    // so the address lives in config (no manual /monitored-mailboxes call).
    centralizedMailbox: optionalEnv('OUTLOOK_CENTRALIZED_MAILBOX', ''),
    redirectUri: optionalEnv(
      'MICROSOFT_REDIRECT_URI',
      'http://localhost:3000/api/v1/outlook/auth/callback',
    ),
    // Addresses on these domains belong to the internal delivery team and are
    // not exposed as customer/vendor contacts in project views.
    internalEmailDomains: [
      ...new Set([
        // These company-owned domains must never appear as external contacts,
        // even when a deployment supplies an incomplete environment override.
        'amberflux.com',
        'amberflux.in',
        'glassflooringsystems.com',
        'gfs.com',
        ...optionalEnv('INTERNAL_EMAIL_DOMAINS', '')
          .split(',')
          .map((domain) => domain.trim().toLowerCase())
          .filter(Boolean),
      ]),
    ],
  },
  mail: {
    // Outgoing mail goes through Microsoft Graph app-only. There is NO SMTP
    // transport: Exchange Online has basic auth disabled tenant-wide, so an
    // SMTP login is refused with 535 however correct the password is. The Graph
    // credentials are the OUTLOOK_* app above, which holds Mail.Send.
    //
    // The mailbox to send as, and the only mail setting there is. It must be a
    // REAL provisioned mailbox: an Entra account without one fails with
    // MailboxNotEnabledForRESTAPI even though the account exists and is enabled.
    // Note the spelling, gfssupport@ with NO hyphen — a gfs-support@ account
    // also exists in the tenant and has no mailbox at all.
    //
    // No default: the address lives in configuration, not in code. Empty is
    // caught at send time with an explicit error rather than at startup, so a
    // missing value cannot take the whole API down over email.
    sender: optionalEnv('MAIL_SENDER', '').trim(),
  },
  queue: {
    provider: (process.env['QUEUE_PROVIDER'] ?? (process.env['AZURE_SERVICE_BUS_CONNECTION_STRING'] ? 'azure_service_bus' : 'in_memory')) as string,
    bullmqRedisUrl: process.env['REDIS_URL'] ?? 'redis://127.0.0.1:6379',
    azureServiceBusConnectionString: process.env['AZURE_SERVICE_BUS_CONNECTION_STRING'] ?? '',
  },
  speech: {
    key: optionalEnv('AZURE_SPEECH_KEY', ''),
    region: optionalEnv('AZURE_SPEECH_REGION', 'centralus'),
    endpoint: optionalEnv('AZURE_SPEECH_ENDPOINT', ''),
    resourceName: optionalEnv('AZURE_SPEECH_RESOURCE_NAME', ''),
  },
  azure: {
    storageConnectionString: optionalEnv('AZURE_STORAGE_CONNECTION_STRING', ''),
    storageContainerName: optionalEnv('AZURE_STORAGE_CONTAINER_NAME', 'documents'),
    aiQueueName: optionalEnv('AZURE_SERVICE_BUS_AI_QUEUE_NAME', 'ai-ocr-ingestion'),
    aiDlqName: optionalEnv('AZURE_SERVICE_BUS_DLQ_NAME', 'ai-ocr-ingestion-dlq'),
    // Dedicated queue for the Teams → AI hand-off (separate from ai-ocr-ingestion).
    teamsQueueName: optionalEnv('AZURE_SERVICE_BUS_TEAMS_QUEUE_NAME', 'teams-ai-integration'),
    teamsDlqName: optionalEnv('AZURE_SERVICE_BUS_TEAMS_DLQ_NAME', 'teams-ai-integration-dlq'),
    defenderQueueName: optionalEnv('AZURE_SERVICE_BUS_DEFENDER_QUEUE_NAME', 'defender-scan-results'),
    defenderDlqName: optionalEnv('AZURE_SERVICE_BUS_DEFENDER_DLQ_NAME', 'defender-scan-results-dlq'),
    extractionStageQueueName: optionalEnv('AZURE_SERVICE_BUS_EXTRACTION_STAGE_QUEUE_NAME', 'ai-stage-trigger'),
    extractionStageDlqName: optionalEnv('AZURE_SERVICE_BUS_EXTRACTION_STAGE_DLQ_NAME', 'ai-stage-trigger-dlq'),
    extractionResultQueueName: optionalEnv('AZURE_SERVICE_BUS_EXTRACTION_RESULT_QUEUE_NAME', 'ai-stage-result'),
    extractionResultDlqName: optionalEnv('AZURE_SERVICE_BUS_EXTRACTION_RESULT_DLQ_NAME', 'ai-stage-result-dlq'),
  },
  dropbox: {
    clientId: optionalEnv('DROPBOX_CLIENT_ID', ''),
    clientSecret: optionalEnv('DROPBOX_CLIENT_SECRET', ''),
    refreshToken: optionalEnv('DROPBOX_REFRESH_TOKEN', ''),
    accessToken: optionalEnv('DROPBOX_ACCESS_TOKEN', ''),
    rootPath: optionalEnv('DROPBOX_ROOT_PATH', '/GFS-Projects'),
    syncIntervalMs: optionalInterval('DROPBOX_SYNC_INTERVAL_MS', 1800000),
    pollingEnabled: optionalEnv('DROPBOX_POLLING_ENABLED', 'true').toLowerCase() === 'true',
  },
  cloudLinks: {
    supportedExtensions: optionalEnv(
      'CLOUD_LINKS_SUPPORTED_EXTENSIONS',
      '.pdf,.docx,.jpg,.jpeg,.png,.txt,.zip'
    )
      .split(',')
      .map((ext) => ext.trim().toLowerCase()),
  },
  aiWebhook: {
    secret: optionalEnv('AI_STAGE_WEBHOOK_SECRET', 'dummy_secret_for_dev_only'),
    maxSkewMs: parseInt(optionalEnv('AI_STAGE_WEBHOOK_MAX_SKEW_MS', '300000'), 10),
  },
  excelGraph: {
    tenantId: optionalEnv('GRAPH_TENANT_ID', ''),
    clientId: optionalEnv('GRAPH_CLIENT_ID', ''),
    clientSecret: optionalEnv('GRAPH_CLIENT_SECRET', ''),
    testUserId: optionalEnv('GRAPH_TEST_USER_ID', 'gfs2@amberflux.in'),
  },
} as const;
