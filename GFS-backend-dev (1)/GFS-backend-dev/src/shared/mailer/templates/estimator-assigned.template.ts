export interface IEstimatorAssignedTemplateInput {
  recipientName?: string | null;
  referenceNumber: string;
  projectName: string;
  customerName?: string | null;
  company?: string | null;
  projectType?: string | null;
  dueDate?: Date | string | null;
  jobAddress?: string | null;
  projectUrl?: string | null;
  assignedByName?: string | null;
  logoUrl?: string | null;
}

export interface IMailContent {
  subject: string;
  text: string;
  html: string;
}

/**
 * Strips email thread prefixes like "Fwd:", "Re:", "FW:", etc. to present
 * a clean project name in notifications and subject lines.
 */
export const cleanProjectName = (name?: string | null): string => {
  if (!name) return 'New Project';
  const cleaned = name.replace(/^((fwd|re|fw)\s*:\s*)+/i, '').trim();
  return cleaned || name.trim() || 'New Project';
};

const formatDueDate = (dueDate?: Date | string | null): string | null => {
  if (!dueDate) return null;
  const d = typeof dueDate === 'string' ? new Date(dueDate) : dueDate;
  if (isNaN(d.getTime())) return String(dueDate);
  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

const escapeHtml = (str?: string | null): string => {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

const resolveLogoUrl = (logoUrl?: string | null, projectUrl?: string | null): string => {
  if (logoUrl?.trim()) return logoUrl.trim();
  if (projectUrl?.trim()) {
    try {
      const parsed = new URL(projectUrl.trim());
      return `${parsed.origin}/gfs.png`;
    } catch {
      // ignore
    }
  }
  return 'https://fetest.amberview.ai/gfs.png';
};

export const buildEstimatorAssignedEmail = (input: IEstimatorAssignedTemplateInput): IMailContent => {
  const cleanName = cleanProjectName(input.projectName);
  // Standard ASCII hyphen " - " avoids MIME multibyte folding issues in mail gateways
  const subject = `New Project in GFS Application: ${input.referenceNumber} - ${cleanName}`;
  const greetingName = input.recipientName?.trim() || 'Estimator';
  const customerOrCompany = [input.customerName?.trim(), input.company?.trim()]
    .filter(Boolean)
    .filter((v, idx, arr) => arr.indexOf(v) === idx)
    .join(' / ');
  const formattedDueDate = formatDueDate(input.dueDate);
  const logoUrl = resolveLogoUrl(input.logoUrl, input.projectUrl);

  // Plain-text version
  const textLines: string[] = [
    `Hi ${greetingName},`,
    '',
    'You have been assigned as the estimator for a new project in GFS application.',
    '',
    'Project Details:',
    `- Reference Number: ${input.referenceNumber}`,
    `- Project Name: ${cleanName}`,
  ];

  if (customerOrCompany) {
    textLines.push(`- Customer / Company: ${customerOrCompany}`);
  }
  if (input.projectType) {
    textLines.push(`- Project Type: ${input.projectType}`);
  }
  if (input.jobAddress) {
    textLines.push(`- Site / Job Address: ${input.jobAddress}`);
  }
  if (formattedDueDate) {
    textLines.push(`- Due Date: ${formattedDueDate}`);
  }

  textLines.push('');
  if (input.projectUrl) {
    textLines.push(`Open Project in GFS Application: ${input.projectUrl}`, '');
  }
  if (input.assignedByName) {
    textLines.push(`Assigned by: ${input.assignedByName}`, '');
  }
  textLines.push('This is an automated notification from Glass Flooring Systems.');

  const text = textLines.join('\n');

  // HTML version — aligned to GFS application design (brand red #CF2E2E & splash bg #E9EBF2)
  const detailRows: string[] = [
    `<tr><td style="padding: 10px 14px; color: #64748b; font-size: 13px; font-weight: 500; width: 140px; vertical-align: top; border-bottom: 1px solid #f1f5f9;">Reference Number</td><td style="padding: 10px 14px; color: #0f172a; font-size: 14px; font-weight: 600; border-bottom: 1px solid #f1f5f9;">${escapeHtml(input.referenceNumber)}</td></tr>`,
    `<tr><td style="padding: 10px 14px; color: #64748b; font-size: 13px; font-weight: 500; vertical-align: top; border-bottom: 1px solid #f1f5f9;">Project Name</td><td style="padding: 10px 14px; color: #0f172a; font-size: 14px; font-weight: 600; border-bottom: 1px solid #f1f5f9;">${escapeHtml(cleanName)}</td></tr>`,
  ];

  if (customerOrCompany) {
    detailRows.push(
      `<tr><td style="padding: 10px 14px; color: #64748b; font-size: 13px; font-weight: 500; vertical-align: top; border-bottom: 1px solid #f1f5f9;">Customer / Company</td><td style="padding: 10px 14px; color: #0f172a; font-size: 14px; border-bottom: 1px solid #f1f5f9;">${escapeHtml(customerOrCompany)}</td></tr>`,
    );
  }
  if (input.projectType) {
    detailRows.push(
      `<tr><td style="padding: 10px 14px; color: #64748b; font-size: 13px; font-weight: 500; vertical-align: top; border-bottom: 1px solid #f1f5f9;">Project Type</td><td style="padding: 10px 14px; color: #0f172a; font-size: 14px; border-bottom: 1px solid #f1f5f9;">${escapeHtml(input.projectType)}</td></tr>`,
    );
  }
  if (input.jobAddress) {
    detailRows.push(
      `<tr><td style="padding: 10px 14px; color: #64748b; font-size: 13px; font-weight: 500; vertical-align: top; border-bottom: 1px solid #f1f5f9;">Site / Job Address</td><td style="padding: 10px 14px; color: #0f172a; font-size: 14px; border-bottom: 1px solid #f1f5f9;">${escapeHtml(input.jobAddress)}</td></tr>`,
    );
  }
  if (formattedDueDate) {
    detailRows.push(
      `<tr><td style="padding: 10px 14px; color: #64748b; font-size: 13px; font-weight: 500; vertical-align: top;">Due Date</td><td style="padding: 10px 14px; color: #0f172a; font-size: 14px;">${escapeHtml(formattedDueDate)}</td></tr>`,
    );
  }

  const ctaButton = input.projectUrl
    ? `
      <div style="margin-top: 26px; text-align: left;">
        <a href="${escapeHtml(input.projectUrl)}" target="_blank" style="display: inline-block; background-color: #CF2E2E; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 14px; padding: 12px 28px; border-radius: 6px; box-shadow: 0 2px 4px rgba(207, 46, 46, 0.25);">
          Open Project in GFS Application
        </a>
      </div>
    `
    : '';

  const assignedByHtml = input.assignedByName
    ? `<p style="margin-top: 20px; font-size: 13px; color: #64748b;">Assigned by: <strong style="color: #0f172a;">${escapeHtml(input.assignedByName)}</strong></p>`
    : '';

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${escapeHtml(subject)}</title>
      </head>
      <body style="margin: 0; padding: 0; background-color: #E9EBF2; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.5; color: #334155;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #E9EBF2; padding: 36px 16px;">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" style="max-width: 600px; background-color: #ffffff; border-radius: 8px; border: 1px solid #d8dce6; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03);" cellspacing="0" cellpadding="0">
                <!-- Top Brand Red Accent Bar -->
                <tr>
                  <td style="height: 4px; background-color: #CF2E2E; font-size: 0; line-height: 0;">&nbsp;</td>
                </tr>
                <!-- Brand Header with GFS Loader Logo -->
                <tr>
                  <td style="padding: 24px 32px 20px; background-color: #ffffff; border-bottom: 1px solid #eef0f5;">
                    <img src="${escapeHtml(logoUrl)}" alt="Glass Flooring Systems" width="150" style="display: block; max-width: 150px; height: auto; border: 0;" />
                  </td>
                </tr>
                <!-- Content Body -->
                <tr>
                  <td style="padding: 28px 32px 32px;">
                    <h3 style="margin: 0 0 16px; font-size: 19px; color: #0f172a; font-weight: 600;">Hi ${escapeHtml(greetingName)},</h3>
                    <p style="margin: 0 0 20px; font-size: 15px; color: #334155; line-height: 1.6;">
                      You have been assigned as the estimator for a <strong style="color: #0f172a;">new project in GFS application</strong>.
                    </p>
                    
                    <!-- Project Details Card -->
                    <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; overflow: hidden; margin-bottom: 20px;">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse: collapse;">
                        ${detailRows.join('\n')}
                      </table>
                    </div>

                    ${ctaButton}
                    ${assignedByHtml}

                    <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 28px 0 16px;" />
                    <p style="margin: 0; font-size: 12px; color: #94a3b8;">
                      This is an automated notification from Glass Flooring Systems.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `.trim();

  return { subject, text, html };
};
