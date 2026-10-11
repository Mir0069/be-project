import axios from 'axios';

import { env } from '@config/index';
import type { UserRole } from '@db/models/user.model';
import { buildInviteEmail } from './templates/invite.template';
import { buildPasswordResetEmail } from './templates/password-reset.template';
import {
  buildEstimatorAssignedEmail,
  type IEstimatorAssignedTemplateInput,
} from './templates/estimator-assigned.template';

export interface ISendMailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface ISendInviteLinkInput {
  to: string;
  firstName: string;
  role: UserRole;
  link: string;
}

export interface ISendPasswordResetLinkInput {
  to: string;
  firstName: string;
  link: string;
}

export interface ISendEstimatorAssignedInput extends IEstimatorAssignedTemplateInput {
  to: string;
}

export interface IMailerService {
  sendMail(input: ISendMailInput): Promise<void>;
  sendInviteLink(input: ISendInviteLinkInput): Promise<void>;
  sendPasswordResetLink(input: ISendPasswordResetLinkInput): Promise<void>;
  sendEstimatorAssignedNotification?(input: ISendEstimatorAssignedInput): Promise<void>;
}

/**
 * Mail sending is deliberately pinned to the STABLE Graph version, not to
 * OUTLOOK_GRAPH_BASE_URL. That variable is set to /beta in production for the
 * ingestion features, and invite and password-reset mail must not ride on a
 * preview API that Microsoft may change without notice.
 */
const GRAPH_SEND_BASE = 'https://graph.microsoft.com/v1.0';


/** Refresh a little early so a token cannot expire mid-request. */
const TOKEN_EXPIRY_SKEW_MS = 60_000;

/**
 * Sends through Microsoft Graph using app-only (client-credentials) auth.
 *
 * There is no SMTP transport, by design. This tenant has SMTP basic auth
 * disabled, so `smtp.office365.com` answers any login with
 * `535 5.7.3 Authentication unsuccessful` regardless of the password; the old
 * Nodemailer path could not have worked against a company mailbox. Graph needs
 * no mailbox password at all, only the Mail.Send application permission already
 * granted to the OUTLOOK_* app registration.
 */
export class GraphMailer implements IMailerService {
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - TOKEN_EXPIRY_SKEW_MS) {
      return this.accessToken;
    }

    const { clientId, clientSecret, tenantId, authority, scope } = env.outlook;
    if (!clientId || !clientSecret || !tenantId) {
      throw new Error(
        'Cannot send mail: OUTLOOK_CLIENT_ID, OUTLOOK_CLIENT_SECRET and OUTLOOK_TENANT_ID are required for Graph mail sending.',
      );
    }

    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope,
      grant_type: 'client_credentials',
    });

    const res = await axios.post(`${authority}/${tenantId}/oauth2/v2.0/token`, body, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    this.accessToken = res.data.access_token as string;
    this.tokenExpiresAt = Date.now() + Number(res.data.expires_in ?? 3600) * 1000;
    return this.accessToken;
  }

  public async sendMail(input: ISendMailInput): Promise<void> {
    const sender = env.mail.sender;
    if (!sender) {
      console.warn(`[GraphMailer] Cannot send mail: MAIL_SENDER is empty. Skipping email dispatch to ${input.to}`);
      return;
    }

    const token = await this.getAccessToken();
    const message = {
      subject: input.subject,
      body: input.html
        ? { contentType: 'HTML', content: input.html }
        : { contentType: 'Text', content: input.text },
      toRecipients: [{ emailAddress: { address: input.to } }],
    };

    try {
      await axios.post(
        `${GRAPH_SEND_BASE}/users/${encodeURIComponent(sender)}/sendMail`,
        { message, saveToSentItems: true },
        { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } },
      );
    } catch (err) {
      // Graph's own message names the real cause, and losing it turns every
      // failure into an unhelpful 500. The two seen in practice are
      // MailboxNotEnabledForRESTAPI (the sender has no mailbox) and
      // ErrorAccessDenied (Mail.Send missing, or an application access policy
      // excludes this mailbox).
      const status = (err as { response?: { status?: number } })?.response?.status;
      const graphError = (err as { response?: { data?: { error?: { code?: string; message?: string } } } })
        ?.response?.data?.error;
      const detail = graphError ? `${graphError.code}: ${graphError.message}` : (err as Error).message;
      throw new Error(`Graph sendMail failed for ${sender} -> ${input.to} (HTTP ${status ?? '?'}). ${detail}`);
    }
  }

  public async sendInviteLink(input: ISendInviteLinkInput): Promise<void> {
    const { subject, text, html } = buildInviteEmail({
      firstName: input.firstName,
      role: input.role,
      link: input.link,
    });
    await this.sendMail({ to: input.to, subject, text, html });
  }

  public async sendPasswordResetLink(input: ISendPasswordResetLinkInput): Promise<void> {
    const { subject, text, html } = buildPasswordResetEmail({
      firstName: input.firstName,
      link: input.link,
    });
    await this.sendMail({ to: input.to, subject, text, html });
  }

  public async sendEstimatorAssignedNotification(input: ISendEstimatorAssignedInput): Promise<void> {
    const { subject, text, html } = buildEstimatorAssignedEmail(input);
    await this.sendMail({ to: input.to, subject, text, html });
  }
}
