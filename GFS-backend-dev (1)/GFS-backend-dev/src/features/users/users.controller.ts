import { StatusCodes } from 'http-status-codes';
import type { Request, Response } from 'express';
import { safeJson } from '@shared/http/safe-json';
import type { UsersService } from './users.service';
import type { ICreateUserRequest, IEditUserRequest } from './users.types';
import type { UserRole } from '@db/models/user.model';

export class UsersController {
  private readonly usersService: UsersService;

  public constructor(usersService: UsersService) {
    this.usersService = usersService;
  }

  public async createUser(req: Request, res: Response): Promise<void> {
    const result = await this.usersService.createUser(req.body as ICreateUserRequest, req.user as { role: UserRole });
    safeJson(res, StatusCodes.CREATED, {
      success: true,
      message: 'User created. Invite email sent.',
      data: { user: result.user, inviteSent: result.inviteSent },
    });
  }

  public async listUsers(req: Request, res: Response): Promise<void> {
    const users = await this.usersService.listUsers(req.user as { role: UserRole });
    safeJson(res, StatusCodes.OK, {
      success: true,
      data: { users },
    });
  }

  public async listEstimators(_req: Request, res: Response): Promise<void> {
    const estimators = await this.usersService.listEstimators();
    safeJson(res, StatusCodes.OK, {
      success: true,
      data: estimators, // Sending array directly or wrapped in data based on standard? The project uses { data: { users } } for listUsers. We'll use { data: estimators } to match typical REST array responses if they map it out.
    });
  }

  public async listSalesManagers(_req: Request, res: Response): Promise<void> {
    const salesManagers = await this.usersService.listSalesManagers();
    safeJson(res, StatusCodes.OK, {
      success: true,
      data: salesManagers,
    });
  }

  public async editUser(req: Request, res: Response): Promise<void> {
    const result = await this.usersService.editUser(req.params['id'] as string, req.body as IEditUserRequest, req.user as { role: UserRole });
    safeJson(res, StatusCodes.OK, {
      success: true,
      message: 'User updated successfully',
      data: { user: result },
    });
  }

  public async disableUser(req: Request, res: Response): Promise<void> {
    const result = await this.usersService.disableUser(req.params['id'] as string, req.user as { role: UserRole });
    safeJson(res, StatusCodes.OK, {
      success: true,
      message: 'User status updated successfully',
      data: { user: result },
    });
  }

  public async resetUserPassword(req: Request, res: Response): Promise<void> {
    await this.usersService.resetUserPassword(req.params['id'] as string, req.user as { role: UserRole });
    safeJson(res, StatusCodes.OK, {
      success: true,
      message: "Password reset link has been sent to your email.",
    });
  }
}
