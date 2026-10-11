import { auditActionForRequest, projectKeyFromUrl } from '@shared/middleware/audit-request.middleware';

describe('projectKeyFromUrl', () => {
  it.each([
    ['/api/v1/projects/GFS-2026-1025/documents', 'GFS-2026-1025'],
    ['/api/v1/proposals/GFS-2026-1025/approve', 'GFS-2026-1025'],
    ['/api/v1/project-workspace/GFS-2026-1025/stages/4', 'GFS-2026-1025'],
    ['/api/v1/projects/Blue%20Ridge/documents?final=true', 'Blue Ridge'],
  ])('reads the project key from %s', (url, expected) => {
    expect(projectKeyFromUrl(url)).toBe(expected);
  });

  it('does not assign a project to a system route', () => {
    expect(projectKeyFromUrl('/api/v1/users/123')).toBeNull();
  });
});

describe('auditActionForRequest', () => {
  it.each([
    ['/api/v1/users/createuser', 'POST', 'user.create'],
    ['/api/v1/users/edituser/507f1f77bcf86cd799439011', 'PUT', 'user.updated'],
    ['/api/v1/users/disableuser/507f1f77bcf86cd799439011', 'PUT', 'user.status.updated'],
    ['/api/v1/users/resetpassword/507f1f77bcf86cd799439011', 'POST', 'user.password.reset'],
    ['/api/v1/auth/logout', 'POST', 'auth.logout'],
  ])('maps %s %s to %s', (path, method, expected) => {
    expect(auditActionForRequest(path, method)).toBe(expected);
  });

  it('leaves unmapped routes available for the generic API action', () => {
    expect(auditActionForRequest('/api/v1/teams/status', 'POST')).toBeNull();
  });
});
