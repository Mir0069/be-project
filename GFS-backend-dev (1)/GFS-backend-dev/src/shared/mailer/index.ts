import { GraphMailer } from './mailer.service';

export * from './mailer.service';
export * from './templates/estimator-assigned.template';

// Microsoft Graph app-only is the only transport. See mailer.service.ts for why
// SMTP was removed rather than kept as a fallback.
export const mailerService = new GraphMailer();

