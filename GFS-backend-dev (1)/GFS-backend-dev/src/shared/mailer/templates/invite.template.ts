import { UserRole } from '@db/models/user.model';

export interface IInviteTemplateInput {
  firstName: string;
  role: UserRole;
  link: string;
}

export interface IMailContent {
  subject: string;
  text: string;
  html: string;
}

const ROLE_LABELS: Record<UserRole, string> = {
  [UserRole.ESTIMATOR]: 'Estimator',
  [UserRole.SALES_MANAGER]: 'Sales Manager',
  [UserRole.SYSTEM_ADMIN]: 'System Admin',
  [UserRole.SUPER_ADMIN]: 'Super Admin',
  [UserRole.HEAD_OF_DIVISION]: 'Head of Division',
};

export const buildInviteEmail = (input: IInviteTemplateInput): IMailContent => {
  const roleLabel = ROLE_LABELS[input.role];
  const subject = `Set up your ${roleLabel} account on GFS`;

  const text = [
    `Hi ${input.firstName},`,
    '',
    `An administrator has created your ${roleLabel} account on GFS.`,
    'Click the link below to set your password and activate your account:',
    '',
    input.link,
    '',
    'This link is valid for 7 days. If you did not expect this email, you can ignore it.',
  ].join('\n');

  const html = `
    <p>Hi ${input.firstName},</p>
    <p>An administrator has created your <strong>${roleLabel}</strong> account on GFS.</p>
    <p>Click the button below to set your password and activate your account:</p>
    <p><a href="${input.link}">Set up your account</a></p>
    <p>This link is valid for 7 days. If you did not expect this email, you can ignore it.</p>
  `;

  return { subject, text, html };
};
