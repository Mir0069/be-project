import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';

import { ZohoWebhookEvent } from '@db/models/zoho-webhook-event.model';
import { env } from '@config/index';

import type { ZohoService } from './zoho.service';
import type { ZohoSyncService } from './zoho-sync.service';
import type { IProjectCrmContextPublisher } from './crm-context.port';

// On a webhook, re-sync leads modified within this look-back window. Generous
// so we never miss the change that triggered the call, even with clock skew.
const WEBHOOK_LOOKBACK_MS = 15 * 60 * 1000;

export class ZohoController {
  private readonly zohoService: ZohoService;
  private readonly syncService: ZohoSyncService;
  private readonly crmContext?: IProjectCrmContextPublisher;

  public constructor(
    zohoService: ZohoService,
    syncService: ZohoSyncService,
    crmContext?: IProjectCrmContextPublisher,
  ) {
    this.zohoService = zohoService;
    this.syncService = syncService;
    this.crmContext = crmContext;
  }

  public initiateAuth(req: Request, res: Response): void {
    const state = typeof req.query['state'] === 'string' ? req.query['state'] : undefined;
    const url = this.zohoService.buildAuthorizeUrl(state);
    res.redirect(url);
  }

  public async handleCallback(req: Request, res: Response): Promise<void> {
    const error = req.query['error'] as string | undefined;
    const errorDescription = req.query['error_description'] as string | undefined;

    if (error) {
      res.status(StatusCodes.BAD_REQUEST).send(`
        <div style="font-family:system-ui,-apple-system,sans-serif;max-width:550px;margin:50px auto;padding:30px;border-radius:12px;background:#fff;border:1px solid #fee2e2;box-shadow:0 4px 6px rgba(0,0,0,0.05);text-align:center;">
          <h2 style="color:#ef4444;margin-bottom:8px;">❌ Zoho Authentication Failed</h2>
          <p style="color:#4b5563;margin-bottom:16px;"><strong>Error:</strong> ${error}</p>
          <p style="color:#6b7280;font-size:14px;margin-bottom:20px;">${errorDescription || ''}</p>
          <a href="/zoho/auth" style="display:inline-block;padding:8px 16px;background:#ef4444;color:#fff;border-radius:6px;text-decoration:none;">Try Again</a>
        </div>
      `);
      return;
    }

    const code = req.query['code'] as string | undefined;
    if (!code) {
      res.status(StatusCodes.BAD_REQUEST).send(`
        <div style="font-family:system-ui,-apple-system,sans-serif;max-width:550px;margin:50px auto;padding:30px;border-radius:12px;background:#fff;border:1px solid #fee2e2;box-shadow:0 4px 6px rgba(0,0,0,0.05);text-align:center;">
          <h2 style="color:#ef4444;margin-bottom:8px;">❌ Authorization Code Missing</h2>
          <p style="color:#6b7280;margin-bottom:20px;">No authorization code was returned by Zoho.</p>
          <a href="/zoho/auth" style="display:inline-block;padding:8px 16px;background:#ef4444;color:#fff;border-radius:6px;text-decoration:none;">Try Again</a>
        </div>
      `);
      return;
    }

    const accountsServer = req.query['accounts-server'] as string | undefined;
    const requestedCallbackUrl = `${req.protocol}://${req.get('host')}${req.baseUrl}${req.path}`;

    try {
      const tokenResponse = await this.zohoService.exchangeCodeForToken(code, accountsServer, requestedCallbackUrl);
      await this.zohoService.persistToken(tokenResponse);

      if (req.accepts('html') && !req.xhr) {
        res.status(StatusCodes.OK).send(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>Zoho Connected</title>
            <meta http-equiv="refresh" content="3;url=${env.app.frontendUrl}/sales-manager/drafts" />
            <style>
              body { font-family: system-ui, -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f8fafc; }
              .card { background: white; padding: 2.5rem; border-radius: 1rem; box-shadow: 0 10px 25px rgba(0,0,0,0.08); text-align: center; max-width: 480px; }
              h1 { color: #16a34a; margin-bottom: 0.5rem; font-size: 1.5rem; }
              p { color: #64748b; margin-bottom: 1.5rem; line-height: 1.5; }
              a { display: inline-block; background: #ef4444; color: white; padding: 0.6rem 1.2rem; border-radius: 0.5rem; text-decoration: none; font-weight: 500; }
            </style>
          </head>
          <body>
            <div class="card">
              <div style="font-size: 3rem; margin-bottom: 1rem;">✅</div>
              <h1>Zoho Connected Successfully!</h1>
              <p>Your Zoho account is authorized (${tokenResponse.api_domain}). Redirecting to Drafts in 3 seconds...</p>
              <a href="${env.app.frontendUrl}/sales-manager/drafts">Return to Drafts Now</a>
            </div>
          </body>
          </html>
        `);
        return;
      }

      res.status(StatusCodes.OK).json({
        success: true,
        message: 'Zoho connected successfully',
        apiDomain: tokenResponse.api_domain,
        scope: tokenResponse.scope,
      });
    } catch (err: any) {
      if (req.accepts('html') && !req.xhr) {
        res.status(StatusCodes.BAD_GATEWAY).send(`
          <div style="font-family:system-ui,-apple-system,sans-serif;max-width:550px;margin:50px auto;padding:30px;border-radius:12px;background:#fff;border:1px solid #fee2e2;box-shadow:0 4px 6px rgba(0,0,0,0.05);text-align:center;">
            <h2 style="color:#ef4444;margin-bottom:8px;">❌ Token Exchange Failed</h2>
            <p style="color:#4b5563;margin-bottom:16px;">${err?.message || 'Failed to exchange authorization code with Zoho.'}</p>
            <a href="/zoho/auth" style="display:inline-block;padding:8px 16px;background:#ef4444;color:#fff;border-radius:6px;text-decoration:none;">Try Again</a>
          </div>
        `);
        return;
      }
      throw err;
    }
  }

  public async devConnect(req: Request, res: Response): Promise<void> {
    await this.zohoService.persistToken({
      access_token: 'mock-local-token',
      refresh_token: 'mock-local-refresh-token',
      api_domain: 'https://www.zohoapis.in',
      scope: env.zoho.scopes,
      expires_in: 31536000,
    });
    if (req.accepts('html') && !req.xhr) {
      res.status(StatusCodes.OK).send(`
        <div style="font-family:system-ui,sans-serif;max-width:500px;margin:50px auto;padding:24px;border-radius:12px;border:1px solid #bbf7d0;background:#f0fdf4;text-align:center;">
          <h2 style="color:#15803d;margin-bottom:8px;">✅ Zoho Local Mock Connected</h2>
          <p style="color:#374151;margin-bottom:16px;">You can now use all Zoho features and approve drafts locally.</p>
          <a href="${env.app.frontendUrl}/sales-manager/drafts" style="display:inline-block;padding:8px 16px;background:#ef4444;color:#fff;border-radius:6px;text-decoration:none;">Go to Drafts</a>
        </div>
      `);
      return;
    }
    res.status(StatusCodes.OK).json({ success: true, message: 'Mock Zoho connected' });
  }

  public async getStatus(_req: Request, res: Response): Promise<void> {
    const token = await this.zohoService.getValidAccessToken();
    res.status(StatusCodes.OK).json({
      success: true,
      connected: true,
      apiDomain: token.apiDomain,
      expiresAt: token.expiresAt,
      scope: token.scope,
    });
  }

  public async fetchModule(req: Request, res: Response): Promise<void> {
    const moduleName = req.params['module'] as string;
    const { page, per_page, fields } = req.query as Record<string, string | undefined>;

    const data = await this.zohoService.fetchFromZoho<unknown>(`/crm/v2/${moduleName}`, {
      page,
      per_page,
      fields,
    });

    res.status(StatusCodes.OK).json({ success: true, data });
  }

  public async insertModule(req: Request, res: Response): Promise<void> {
    const moduleName = req.params['module'] as string;
    const data = await this.zohoService.insertIntoZoho<unknown>(`/crm/v2/${moduleName}`, req.body);

    res.status(StatusCodes.CREATED).json({ success: true, data });
  }

  /**
   * Diagnostic webhook receiver. Catches whatever Zoho sends, logs it to the
   * terminal, and persists the raw payload for inspection. It never calls back
   * out to Zoho (pure receive — read-only with respect to their CRM).
   *
   * Responds 200 immediately so Zoho marks delivery as successful.
   */
  public async handleWebhook(req: Request, res: Response): Promise<void> {
    const receivedAt = new Date();
    const ua = req.headers['user-agent'] ?? '(none)';
    const ip = req.headers['x-forwarded-for'] ?? req.ip ?? '(unknown)';

    // ---- 1. RECEIVED -----------------------------------------------------
    console.log('\n┌──────────── ZOHO WEBHOOK RECEIVED ────────────');
    console.log(`│ time:       ${receivedAt.toISOString()}`);
    console.log(`│ method:     ${req.method}`);
    console.log(`│ from IP:    ${ip}`);
    console.log(`│ user-agent: ${ua}`);
    console.log(`│ query:      ${JSON.stringify(req.query)}`);
    console.log(`│ body:       ${JSON.stringify(req.body)}`);
    console.log('└───────────────────────────────────────────────');

    // ---- 2. PERSIST raw event -------------------------------------------
    try {
      await ZohoWebhookEvent.create({
        method: req.method,
        query: req.query,
        headers: { 'content-type': req.headers['content-type'], 'user-agent': req.headers['user-agent'] },
        body: req.body,
        receivedAt,
      });
      console.log('  [WEBHOOK] ✓ raw event saved to DB');
    } catch (err) {
      console.error(`  [WEBHOOK] ✗ FAILED to save raw event: ${ZohoController.describeError(err)}`);
    }

    // ---- 3. ACK Zoho immediately ----------------------------------------
    res.status(StatusCodes.OK).json({ success: true });
    console.log('  [WEBHOOK] ✓ responded 200 to Zoho');

    // ---- 4. SYNC in background (fetch-and-diff; read-only to Zoho) -------
    console.log('  [WEBHOOK] → syncing leads modified in last 15m...');
    void this.syncService
      .syncModifiedSince(Date.now() - WEBHOOK_LOOKBACK_MS, 'webhook')
      .then((s) => {
        if (s.changeEntries > 0) {
          console.log(
            `  [WEBHOOK] ✓ SYNC OK — scanned ${s.scanned}, ${s.created} new, ${s.updated} updated, ${s.changeEntries} change(s) logged (via webhook)`,
          );
        } else {
          console.log(
            `  [WEBHOOK] ✓ SYNC OK — scanned ${s.scanned}, but NO changes detected (lead may be older than 15m, or only noise fields changed)`,
          );
        }
      })
      .catch((err) => {
        console.error(`  [WEBHOOK] ✗ SYNC FAILED: ${ZohoController.describeError(err)}`);
      });
  }

  /** Pulls a readable message (+ details for AppErrors) out of any thrown value. */
  private static describeError(err: unknown): string {
    if (err instanceof Error) {
      const details = (err as { details?: unknown }).details;
      return details ? `${err.message} | details=${JSON.stringify(details)}` : err.message;
    }
    return String(err);
  }

  public async getLeadNotes(req: Request, res: Response): Promise<void> {
    const zohoLeadId = req.params['zohoLeadId'] as string;
    const notes = await this.zohoService.fetchLeadNotes(zohoLeadId);
    res.status(StatusCodes.OK).json({ success: true, data: { notes } });


    if (this.crmContext) {
      void this.crmContext
        .publishForLead(zohoLeadId, notes)
        .catch((err) =>
          console.error(`  [ZOHO] crm-context publish failed: ${ZohoController.describeError(err)}`),
        );
    }
  } 
}
