export interface IPasswordResetTemplateInput {
  firstName: string;
  link: string;
}

export interface IMailContent {
  subject: string;
  text: string;
  html: string;
}

export const buildPasswordResetEmail = (
  input: IPasswordResetTemplateInput,
): IMailContent => {
  const subject = 'Reset your GFS password';

  const text = [
    `Hi ${input.firstName},`,
    '',
    'We received a request to reset your GFS password.',
    'Click the link below to choose a new password:',
    '',
    input.link,
    '',
    'This link is valid for 24 hours.',
    'If you did not request a password reset, you can ignore this email.',
  ].join('\n');

  const html = `
    <p>Hi ${input.firstName},</p>
    <p>We received a request to reset your GFS password.</p>
    <p>Click the button below to choose a new password:</p>
    <p><a href="${input.link}">Reset your password</a></p>
    <p>This link is valid for 24 hours.</p>
    <p>If you did not request a password reset, you can ignore this email.</p>
  `;

  return { subject, text, html };
};
