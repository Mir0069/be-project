import { buildEstimatorAssignedEmail } from '@shared/mailer/templates/estimator-assigned.template';

describe('buildEstimatorAssignedEmail template', () => {
  it('builds email with all fields correctly formatted', () => {
    const input = {
      recipientName: 'Alice Smith',
      referenceNumber: 'GFS-2026-1001',
      projectName: 'City Center Glazing',
      customerName: 'Apex Builders',
      company: 'Apex Group',
      projectType: 'NEW_ESTIMATE',
      dueDate: new Date('2026-10-15T00:00:00.000Z'),
      jobAddress: '123 High Street, London',
      projectUrl: 'https://gfs.amberview.ai/projects/proj-123',
      assignedByName: 'Bob Manager',
    };

    const { subject, text, html } = buildEstimatorAssignedEmail(input);

    // Subject with ASCII hyphen
    expect(subject).toBe('New Project in GFS Application: GFS-2026-1001 - City Center Glazing');

    // Text assertions
    expect(text).toContain('Hi Alice Smith,');
    expect(text).toContain('You have been assigned as the estimator for a new project in GFS application.');
    expect(text).toContain('- Reference Number: GFS-2026-1001');
    expect(text).toContain('- Project Name: City Center Glazing');
    expect(text).toContain('- Customer / Company: Apex Builders / Apex Group');
    expect(text).toContain('- Project Type: NEW_ESTIMATE');
    expect(text).toContain('- Site / Job Address: 123 High Street, London');
    expect(text).toContain('- Due Date: 15 Oct 2026');
    expect(text).toContain('Open Project in GFS Application: https://gfs.amberview.ai/projects/proj-123');
    expect(text).toContain('Assigned by: Bob Manager');

    // Scope and description should NOT be in the email
    expect(text.toLowerCase()).not.toContain('scope');
    expect(text.toLowerCase()).not.toContain('description');

    // HTML assertions - brand colors and logo
    expect(html).toContain('Hi Alice Smith,');
    expect(html).toContain('new project in GFS application');
    expect(html).toContain('GFS-2026-1001');
    expect(html).toContain('City Center Glazing');
    expect(html).toContain('Apex Builders / Apex Group');
    expect(html).toContain('NEW_ESTIMATE');
    expect(html).toContain('123 High Street, London');
    expect(html).toContain('href="https://gfs.amberview.ai/projects/proj-123"');
    expect(html).toContain('Open Project in GFS Application');
    expect(html).toContain('Assigned by: <strong style="color: #0f172a;">Bob Manager</strong>');
    expect(html).toContain('#CF2E2E'); // Brand red accent & button
    expect(html).toContain('#E9EBF2'); // Application splash background
    expect(html).toContain('gfs.png'); // GFS loader logo
    expect(html.toLowerCase()).not.toContain('scope');
    expect(html.toLowerCase()).not.toContain('description');
  });

  it('strips leading Fwd:, Re:, and FW: prefixes from project name in subject and body', () => {
    const input = {
      referenceNumber: 'GFS-2026-1002',
      projectName: 'Fwd: project request for Jane Street',
    };

    const { subject, text, html } = buildEstimatorAssignedEmail(input);

    expect(subject).toBe('New Project in GFS Application: GFS-2026-1002 - project request for Jane Street');
    expect(text).toContain('- Project Name: project request for Jane Street');
    expect(html).toContain('project request for Jane Street');
  });

  it('handles optional fields gracefully with fallbacks', () => {
    const input = {
      referenceNumber: 'GFS-2026-1002',
      projectName: 'Minimal Project',
    };

    const { subject, text, html } = buildEstimatorAssignedEmail(input);

    expect(subject).toBe('New Project in GFS Application: GFS-2026-1002 - Minimal Project');
    expect(text).toContain('Hi Estimator,');
    expect(html).toContain('Hi Estimator,');
    expect(text).not.toContain('Customer / Company:');
    expect(text).not.toContain('Due Date:');
    expect(text).not.toContain('Site / Job Address:');
    expect(text).not.toContain('Open Project in GFS Application:');
    expect(text).not.toContain('Assigned by:');
  });

  it('escapes special characters in HTML to prevent injection', () => {
    const input = {
      recipientName: '<script>alert("xss")</script>',
      referenceNumber: 'GFS-2026-1003',
      projectName: 'Test & Build <Company>',
      customerName: 'Safe & Sound',
      company: 'Safe & Sound',
    };

    const { html } = buildEstimatorAssignedEmail(input);

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    expect(html).toContain('Test &amp; Build &lt;Company&gt;');
    // Deduplication of identical customer and company
    expect(html).toContain('Safe &amp; Sound');
  });
});
