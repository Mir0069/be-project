import type { Request, Response, NextFunction } from 'express';
import { Project } from '@db/models/project.model';
import { UserRole } from '@db/models/user.model';
import { AppError } from '@shared/errors/app.error';
import { hasAnyRole } from '@shared/security/role-access';
import { StatusCodes } from 'http-status-codes';

const ROLES_WITH_FULL_PROJECT_ACCESS: string[] = [
  UserRole.SALES_MANAGER,
  UserRole.SYSTEM_ADMIN,
  UserRole.SUPER_ADMIN,
];

/**
 * Express param guard for routes carrying a `:projectId`.
 *
 * Sales managers and admins work across the whole pipeline. An estimator only
 * reaches a project they are assigned to, which also means an unassigned
 * project is reachable by nobody but a manager until it is handed out.
 *
 * Registered with router.param() rather than per route on purpose: a guard
 * spelled out route by route is one a new route can forget, and the proposal
 * router alone has more than twenty project-scoped endpoints.
 *
 * Requests that arrive without an authenticated user pass through untouched.
 * That is not a hole: the only such routes are the system AI callbacks which
 * are deliberately mounted ahead of `authenticate`, and every other route sits
 * behind it, so `req.user` is always populated by the time this runs.
 */
export const requireProjectAccess = async (
  req: Request,
  _res: Response,
  next: NextFunction,
  projectId: string,
): Promise<void> => {
  const user = req.user;
  if (!user) return next();
  if (hasAnyRole(user.role, ROLES_WITH_FULL_PROJECT_ACCESS)) return next();

  try {
    const project = await Project.findById(projectId)
      .select('assignedEstimators')
      .lean()
      .exec() as { assignedEstimators?: unknown[] } | null;

    if (!project) {
      return next(new AppError('Project not found', StatusCodes.NOT_FOUND, true));
    }

    const isAssigned = (project.assignedEstimators ?? []).some((estimator: any) => {
      const estimatorId = estimator && typeof estimator === 'object'
        ? estimator._id ?? estimator.id
        : estimator;
      return String(estimatorId) === String(user.userId);
    });

    if (!isAssigned) {
      return next(new AppError(
        'You are not assigned to this project.',
        StatusCodes.FORBIDDEN,
        true,
      ));
    }

    return next();
  } catch (err) {
    // A malformed id should read as "no such project", not a 500.
    return next(new AppError('Project not found', StatusCodes.NOT_FOUND, true));
  }
};
