import type { NextFunction, Request, Response } from 'express';
import { UserRole } from '@db/models/user.model';
import { auditCategoryForAction, auditLogService } from '@features/audit-logs/audit-logs.service';
import { AuditLogSource, AuditLogVisibility } from '@features/audit-logs/audit-logs.types';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const stringParam = (value: unknown): string | null => {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Array.isArray(value) && typeof value[0] === 'string' && value[0].trim()) return value[0].trim();
  return null;
};

const routePattern = (req: Request): string => {
  const route = req.route?.path;
  if (typeof route === 'string') return `${req.baseUrl}${route}`;
  return req.originalUrl.split('?')[0] || req.path;
};

const isBasicProcessingRequest = (path: string, method: string): boolean => {
  if (/(analysis|extract|processing|status)/i.test(path)) return true;
  return path.includes('/documents') && (method === 'POST' || method === 'PATCH');
};

/** Map common admin routes to stable, human-readable audit actions. */
export const auditActionForRequest = (path: string, method: string): string | null => {
  const normalizedPath = path.toLowerCase();
  const normalizedMethod = method.toUpperCase();

  if (/\/users\/createuser\/?$/.test(normalizedPath) && normalizedMethod === 'POST') return 'user.create';
  if (/\/users\/edituser\/[^/]+\/?$/.test(normalizedPath) && normalizedMethod === 'PUT') return 'user.updated';
  if (/\/users\/disableuser\/[^/]+\/?$/.test(normalizedPath) && normalizedMethod === 'PUT') return 'user.status.updated';
  if (/\/users\/resetpassword\/[^/]+\/?$/.test(normalizedPath) && normalizedMethod === 'POST') return 'user.password.reset';
  if (/\/auth\/register\/?$/.test(normalizedPath) && normalizedMethod === 'POST') return 'user.create';
  if (/\/auth\/logout\/?$/.test(normalizedPath) && normalizedMethod === 'POST') return 'auth.logout';
  if (/\/auth\/set-password\/?$/.test(normalizedPath) && normalizedMethod === 'POST') return 'auth.password.set';

  return null;
};

const requestUserLabel = (body: unknown): string | null => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const values = body as Record<string, unknown>;
  const email = typeof values['email'] === 'string' ? values['email'].trim().toLowerCase() : '';
  const name = [values['firstName'], values['lastName']]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.trim())
    .join(' ');
  return [name, email].filter(Boolean).join(' · ') || null;
};

// This middleware runs before feature routers populate req.params. Read the
// concrete URL instead, so the audit row keeps its project context after the
// response has finished.
export const projectKeyFromUrl = (url: string): string | null => {
  const pathname = url.split('?')[0] ?? '';
  const match = pathname.match(/\/(?:projects|proposals|project-workspace)\/([^/?#]+)/i);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
};

export const auditRequestMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  if (!MUTATING_METHODS.has(req.method)) {
    next();
    return;
  }
  const requestProjectKey = projectKeyFromUrl(req.originalUrl);

  res.once('finish', () => {
    const user = req.user;
    if (!user) return;

    const path = routePattern(req);
    if (path.includes('/audit-logs')) return;

    const projectScoped = /\/(projects|project-workspace|proposals)(\/|$)/i.test(path);
    const documentId = stringParam(req.params['documentId']);
    const userId = stringParam(req.params['id']) && /\/users\//i.test(path)
      ? stringParam(req.params['id'])
      : null;
    const projectId = stringParam(req.params['projectId'])
      ?? (projectScoped ? stringParam(req.params['id']) : null)
      ?? requestProjectKey;
    const semanticAction = auditActionForRequest(path, req.method);
    const createdUserLabel = semanticAction === 'user.create' ? requestUserLabel(req.body) : null;
    const targetType = documentId
      ? 'DOCUMENT'
      : userId || createdUserLabel
        ? 'USER'
        : projectId
          ? 'PROJECT'
          : 'HTTP_REQUEST';
    const targetId = documentId ?? userId ?? projectId;
    const action = semanticAction ?? `api.${req.method.toLowerCase()}.${path.replace(/[^a-zA-Z0-9]+/g, '.')}`
      .replace(/\.+/g, '.')
      .replace(/\.$/, '');

    void auditLogService.recordBestEffort({
      action,
      category: auditCategoryForAction(path),
      visibility: isBasicProcessingRequest(path, req.method)
        ? AuditLogVisibility.BASIC
        : AuditLogVisibility.FULL,
      actorId: user.userId,
      actorRole: user.role as UserRole,
      actorEmail: user.email,
      projectId,
      targetType,
      targetId,
      targetLabel: createdUserLabel,
      description: semanticAction === 'user.create'
        ? res.statusCode >= 400
          ? 'A team member account could not be created.'
          : 'A new team member account was created.'
        : `${req.method} ${path} returned ${res.statusCode}`,
      metadata: {
        method: req.method,
        path,
        statusCode: res.statusCode,
        outcome: res.statusCode >= 400 ? 'FAILURE' : 'SUCCESS',
        ...(createdUserLabel ? { targetLabel: createdUserLabel } : {}),
        ...(req.body && typeof req.body === 'object' && !Array.isArray(req.body) && typeof req.body.role === 'string'
          ? { targetRole: req.body.role }
          : {}),
      },
      source: AuditLogSource.API,
      requestId: stringParam(req.headers['x-request-id']),
    });
  });

  next();
};
