import type { Request, Response } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { StatusCodes } from 'http-status-codes';
import { env } from '@config/index';
import { UserRole } from '@db/models/user.model';
import { AppError } from '@shared/errors/app.error';
import { safeJson } from '@shared/http/safe-json';
import type { AuthService } from './auth.service';
import type {
  IAuthUser,
  IForgotPasswordRequest,
  ILoginRequest,
  IRegisterRequest,
  ISetPasswordRequest,
  OAuthProvider,
} from './auth.types';

const isCloudOrProd =
  env.app.nodeEnv === 'production' ||
  env.app.nodeEnv === 'test' ||
  Boolean(process.env['CONTAINER_APP_NAME']) ||
  !env.app.frontendUrl?.includes('localhost');

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: isCloudOrProd,
  sameSite: (isCloudOrProd ? 'none' : 'lax') as 'none' | 'lax',
};

const OAUTH_STATE_COOKIE_NAME = 'oauthState';
const OAUTH_STATE_COOKIE_PATH = `/api/${env.app.apiVersion}/auth/oauth`;

const OAUTH_STATE_COOKIE_OPTIONS = {
  ...COOKIE_OPTIONS,
  path: OAUTH_STATE_COOKIE_PATH,
  maxAge: 10 * 60 * 1000,
};

const OAUTH_STATE_CLEAR_OPTIONS = {
  ...COOKIE_OPTIONS,
  path: OAUTH_STATE_COOKIE_PATH,
};

const ACCESS_TOKEN_COOKIE_OPTIONS = {
  ...COOKIE_OPTIONS,
  maxAge: 15 * 60 * 1000,
};

const REFRESH_TOKEN_COOKIE_OPTIONS = {
  ...COOKIE_OPTIONS,
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

export class AuthController {
  private readonly authService: AuthService;

  public constructor(authService: AuthService) {
    this.authService = authService;
  }

  public async login(req: Request, res: Response): Promise<void> {
    const { email, password } = req.body as ILoginRequest;
    const { accessToken, refreshToken, user } = await this.authService.login({ email, password });

    res
      .cookie('accessToken', accessToken, ACCESS_TOKEN_COOKIE_OPTIONS)
      .cookie('refreshToken', refreshToken, REFRESH_TOKEN_COOKIE_OPTIONS);
    safeJson(res, StatusCodes.OK, {
      success: true,
      message: 'Logged in successfully',
      data: { user: this.serializeUser(user) },
    });
  }

  public async register(req: Request, res: Response): Promise<void> {
    const { email, password, firstName, lastName, role } = req.body as IRegisterRequest;
      await this.authService.register({
      email,
      password,
      firstName,
      lastName,
      role,
    }, req.user?.role);

    safeJson(res, StatusCodes.CREATED, {
      success: true,
      message: 'Registered successfully',
    });
  }

  public async forgotPassword(req: Request, res: Response): Promise<void> {
    const { email } = req.body as IForgotPasswordRequest;
    await this.authService.forgotPassword(email);
    safeJson(res, StatusCodes.OK, {
      success: true,
      message: 'If an account exists for that email, a reset link has been sent.',
    });
  }

  public async setPassword(req: Request, res: Response): Promise<void> {
    const { token, password } = req.body as ISetPasswordRequest;
    await this.authService.setPassword(token, password);
    safeJson(res, StatusCodes.OK, {
      success: true,
      message: 'Password set successfully. You can now log in.',
    });
  }

  public async logout(req: Request, res: Response): Promise<void> {
    await this.authService.logout(req.user!.userId);

    res
      .clearCookie('accessToken', COOKIE_OPTIONS)
      .clearCookie('refreshToken', COOKIE_OPTIONS);
    safeJson(res, StatusCodes.OK, { success: true, message: 'Logged out successfully' });
  }

  public async refresh(req: Request, res: Response): Promise<void> {
    const authHeader = req.headers.authorization;
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    const rawRefreshToken = (req.cookies?.['refreshToken'] as string | undefined) || bearerToken;

    if (!rawRefreshToken) {
      throw new AppError('Refresh token missing', StatusCodes.UNAUTHORIZED);
    }

    const { accessToken, refreshToken } = await this.authService.refresh(rawRefreshToken);

    res
      .cookie('accessToken', accessToken, ACCESS_TOKEN_COOKIE_OPTIONS)
      .cookie('refreshToken', refreshToken, REFRESH_TOKEN_COOKIE_OPTIONS);
    safeJson(res, StatusCodes.OK, {
      success: true,
      message: 'Token refreshed successfully',
      accessToken,
    });
  }

  public async getMe(req: Request, res: Response): Promise<void> {
    const user = await this.authService.getMe(req.user!.userId);

    safeJson(res, StatusCodes.OK, {
      success: true,
      data: { user: this.serializeUser(user) },
    });
  }

  public async oauthRedirect(req: Request, res: Response): Promise<void> {
    const provider = req.params['provider'];
    if (provider !== 'google' && provider !== 'microsoft') {
      throw new AppError('Invalid OAuth provider', StatusCodes.BAD_REQUEST);
    }

    const OAUTH_ALLOWED_ROLES: UserRole[] = [UserRole.ESTIMATOR, UserRole.SALES_MANAGER];
    const rawRole = req.query['role'] as string | undefined;
    const role: UserRole =
      rawRole && (OAUTH_ALLOWED_ROLES as string[]).includes(rawRole)
        ? (rawRole as UserRole)
        : UserRole.ESTIMATOR;

    const state = this.generateOAuthStateToken(role);
    const consentUrl = this.authService.getOAuthConsentUrl(provider as OAuthProvider, state);
    res.cookie(OAUTH_STATE_COOKIE_NAME, state, OAUTH_STATE_COOKIE_OPTIONS);
    res.redirect(consentUrl);
  }

  public async oauthCallback(req: Request, res: Response): Promise<void> {
    const provider = req.params['provider'];
    const providerError = req.query['error'];
    const state = req.query['state'];
    const code = req.query['code'];

    if (provider !== 'google' && provider !== 'microsoft') {
      throw new AppError('Invalid OAuth provider', StatusCodes.BAD_REQUEST);
    }

    if (typeof providerError === 'string' && providerError) {
      res
        .clearCookie(OAUTH_STATE_COOKIE_NAME, OAUTH_STATE_CLEAR_OPTIONS)
        .redirect(`${env.app.frontendUrl}/login?oauth=access_denied`);
      return;
    }

    if (typeof state !== 'string' || !state) {
      res.clearCookie(OAUTH_STATE_COOKIE_NAME, OAUTH_STATE_CLEAR_OPTIONS);
      throw new AppError('OAuth state missing', StatusCodes.BAD_REQUEST);
    }

    const cookieState = req.cookies?.[OAUTH_STATE_COOKIE_NAME] as string | undefined;
    const role = this.verifyOAuthStateToken(state);
    if (!cookieState || cookieState !== state || role === null) {
      res.clearCookie(OAUTH_STATE_COOKIE_NAME, OAUTH_STATE_CLEAR_OPTIONS);
      throw new AppError('Invalid OAuth state', StatusCodes.BAD_REQUEST);
    }

    if (typeof code !== 'string' || !code) {
      res.clearCookie(OAUTH_STATE_COOKIE_NAME, OAUTH_STATE_CLEAR_OPTIONS);
      throw new AppError('OAuth authorization code missing', StatusCodes.BAD_REQUEST);
    }

    try {
      const { accessToken, refreshToken } = await this.authService.loginWithOAuthCode(
        provider as OAuthProvider,
        code,
        role,
      );

      res
        .clearCookie(OAUTH_STATE_COOKIE_NAME, OAUTH_STATE_CLEAR_OPTIONS)
        .cookie('accessToken', accessToken, ACCESS_TOKEN_COOKIE_OPTIONS)
        .cookie('refreshToken', refreshToken, REFRESH_TOKEN_COOKIE_OPTIONS)
        .redirect(`${env.app.frontendUrl}/login?oauth=success`);
    } catch (error) {
      console.error('OAuth callback failed', {
        provider,
        error: error instanceof Error ? error.message : error,
      });
      res
        .clearCookie(OAUTH_STATE_COOKIE_NAME, OAUTH_STATE_CLEAR_OPTIONS)
        .redirect(`${env.app.frontendUrl}/login?oauth=failed`);
    }
  }

  private generateOAuthStateToken(role: UserRole): string {
    const nonce = crypto.randomBytes(16).toString('hex');
    return jwt.sign(
      { purpose: 'oauth_state', nonce, role },
      env.auth.jwtSecret,
      { expiresIn: '10m', audience: 'oauth_state' },
    );
  }

  private verifyOAuthStateToken(stateToken: string): UserRole | null {
    try {
      const decoded = jwt.verify(stateToken, env.auth.jwtSecret, {
        audience: 'oauth_state',
      }) as { purpose?: string; role?: string };
      if (decoded.purpose !== 'oauth_state') return null;
      const role = decoded.role as UserRole | undefined;
      if (!role || !(Object.values(UserRole) as string[]).includes(role)) return null;
      return role;
    } catch {
      return null;
    }
  }

  private serializeUser(user: IAuthUser): Omit<IAuthUser, 'passwordHash' | 'refreshTokenHash'> {
    return {
      id: user.id,
      email: user.email,
      authProvider: user.authProvider,
      providerId: user.providerId,
      role: user.role,
      firstName: user.firstName,
      lastName: user.lastName,
      isActive: user.isActive,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
