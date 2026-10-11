import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import axios from 'axios';
import { StatusCodes } from 'http-status-codes';
import { env } from '@config/index';
import { AppError } from '@shared/errors/app.error';
import { assertValidPassword } from '@shared/security/password-policy';
import { canManageRole } from '@shared/security/role-access';
import { AuthProvider, UserRole } from '@db/models/user.model';
import { PasswordResetTokenPurpose } from '@db/models/password-reset-token.model';
import type { IUserRepository } from '@repositories/interfaces/i-user.repository';
import type { IPasswordResetTokenRepository } from '@repositories/interfaces/i-password-reset-token.repository';
import type { IMailerService } from '@shared/mailer/mailer.service';
import { generateRawToken, hashToken } from '@shared/utils/generate-token';
import type {
  IAuthTokenPayload,
  IAuthLoginResult,
  IAuthTokens,
  IAuthUser,
  ILoginRequest,
  IRegisterRequest,
  IOAuthProfile,
  OAuthProvider,
} from './auth.types';
import mongoose from 'mongoose';

const RESET_TTL_MS = 24 * 60 * 60 * 1000;

interface IOAuthProviderConfig {
  clientId: string;
  clientSecret: string;
  authUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  scope: string;
  redirectUri: string;
}

export class AuthService {
  private readonly userRepository: IUserRepository;
  private readonly passwordResetTokenRepository: IPasswordResetTokenRepository;
  private readonly mailerService: IMailerService;

  public constructor(
    userRepository: IUserRepository,
    passwordResetTokenRepository: IPasswordResetTokenRepository,
    mailerService: IMailerService,
  ) {
    this.userRepository = userRepository;
    this.passwordResetTokenRepository = passwordResetTokenRepository;
    this.mailerService = mailerService;
  }

  public async login(data: ILoginRequest): Promise<IAuthLoginResult> {
    if (!data || typeof data.email !== 'string' || typeof data.password !== 'string') {
      throw new AppError('Email and password are required', StatusCodes.BAD_REQUEST);
    }

    const normalizedEmail = data.email.trim().toLowerCase();
    const rawPassword = data.password;
    if (!normalizedEmail || !rawPassword.trim()) {
      throw new AppError('Email and password are required', StatusCodes.BAD_REQUEST);
    }

    const user = await this.userRepository.findByEmailWithPassword(normalizedEmail);

    if (!user || !user.isActive) {
      throw new AppError('Invalid email or password', StatusCodes.UNAUTHORIZED, true, { details: { dbg: user ? (user.isActive ? 'active_but_unreachable' : 'not_active') : 'not_found', dbName: mongoose.connection.name } });
    }

    if (!user.passwordHash) {
      if (user.authProvider === AuthProvider.LOCAL) {
        throw new AppError(
          'Account setup pending. Please use the setup link emailed to you.',
          StatusCodes.BAD_REQUEST,
        );
      }
      throw new AppError('Please login with your OAuth provider', StatusCodes.BAD_REQUEST);
    }

    const isPasswordValid = await bcrypt.compare(rawPassword, user.passwordHash);
    if (!isPasswordValid) {
      throw new AppError('Invalid email or password', StatusCodes.UNAUTHORIZED, true, { details: { dbg: 'bad_pass' } });
    }

    // Keep existing passwords valid, but transparently upgrade hashes created
    // with weaker cost settings after the user proves ownership of the account.
    if (bcrypt.getRounds(user.passwordHash) < env.auth.bcryptSaltRounds) {
      const upgradedHash = await bcrypt.hash(rawPassword, env.auth.bcryptSaltRounds);
      await this.userRepository.updateById(user.id, { passwordHash: upgradedHash });
    }

    const tokens = await this.issueAndPersistTokens(user);

    return {
      ...tokens,
      user,
    };
  }

  public async register(data: IRegisterRequest, actorRole?: UserRole): Promise<void> {
    if (
      !data ||
      typeof data.email !== 'string' ||
      typeof data.password !== 'string' ||
      typeof data.firstName !== 'string' ||
      typeof data.lastName !== 'string' ||
      typeof data.role !== 'string'
    ) {
      throw new AppError('Email, password, first name, last name, and role are required', StatusCodes.BAD_REQUEST);
    }

    const normalizedEmail = data.email.trim().toLowerCase();
    const rawPassword = data.password;
    const firstName = data.firstName.trim();
    const lastName = data.lastName.trim();
    const role = data.role;

    if (!normalizedEmail || !rawPassword.trim() || !firstName || !lastName) {
      throw new AppError('Email, password, first name, last name, and role are required', StatusCodes.BAD_REQUEST);
    }

    if (!(Object.values(UserRole) as string[]).includes(role)) {
      throw new AppError(`Invalid role. Allowed roles: ${Object.values(UserRole).join(', ')}`, StatusCodes.BAD_REQUEST);
    }

    if (!canManageRole(actorRole, role)) {
      throw new AppError('Only Super Admin can create Head of Division', StatusCodes.FORBIDDEN);
    }

    assertValidPassword(rawPassword, { email: normalizedEmail, firstName, lastName });

    const existingUser = await this.userRepository.findByEmail(normalizedEmail);
    if (existingUser) {
      throw new AppError('User already exists with this email', StatusCodes.CONFLICT);
    }

    const passwordHash = await bcrypt.hash(rawPassword, env.auth.bcryptSaltRounds);
    await this.userRepository.create({
      email: normalizedEmail,
      passwordHash,
      authProvider: AuthProvider.LOCAL,
      role,
      firstName,
      lastName,
    });
    return;
  }

  public getOAuthConsentUrl(provider: OAuthProvider, state: string): string {
    if (!state) {
      throw new AppError('OAuth state is required', StatusCodes.BAD_REQUEST);
    }

    const oauthConfig = this.getOAuthProviderConfig(provider);

    const params = new URLSearchParams({
      client_id: oauthConfig.clientId,
      redirect_uri: oauthConfig.redirectUri,
      response_type: 'code',
      scope: oauthConfig.scope,
      state,
    });

    if (provider === 'google') {
      params.set('access_type', 'offline');
      params.set('prompt', 'consent');
    }

    return `${oauthConfig.authUrl}?${params.toString()}`;
  }

  public async loginWithOAuthCode(
    provider: OAuthProvider,
    code: string,
    role: UserRole = UserRole.ESTIMATOR,
  ): Promise<IAuthTokens> {
    if (!code || !code.trim()) {
      throw new AppError('OAuth code is required', StatusCodes.BAD_REQUEST);
    }

    const profile = await this.exchangeOAuthCodeForProfile(provider, code.trim());
    const providerEnum = provider === 'google' ? AuthProvider.GOOGLE : AuthProvider.MICROSOFT;

    let user = await this.userRepository.findByProviderId(providerEnum, profile.providerId);

    if (!user) {
      const existingUserByEmail = await this.userRepository.findByEmail(profile.email);
      if (existingUserByEmail) {
        throw new AppError(
          'Account already exists with a different sign-in method',
          StatusCodes.CONFLICT,
        );
      }
    }

    if (!user) {
      user = await this.userRepository.create({
        email: profile.email,
        authProvider: providerEnum,
        providerId: profile.providerId,
        role,
        firstName: profile.firstName,
        lastName: profile.lastName,
      });
    }

    if (!user.isActive) {
      throw new AppError('User account is inactive', StatusCodes.FORBIDDEN);
    }

    return this.issueAndPersistTokens(user);
  }

  public async refresh(rawRefreshToken: string): Promise<IAuthTokens> {
    if (!rawRefreshToken || !rawRefreshToken.trim()) {
      throw new AppError('Invalid or expired refresh token', StatusCodes.UNAUTHORIZED);
    }

    const trimmedRefreshToken = rawRefreshToken.trim();
    let payload: IAuthTokenPayload;

    try {
      payload = jwt.verify(trimmedRefreshToken, env.auth.jwtRefreshSecret) as IAuthTokenPayload;
    } catch {
      throw new AppError('Invalid or expired refresh token', StatusCodes.UNAUTHORIZED);
    }

    const user = await this.userRepository.findByIdWithRefreshToken(payload.userId);

    if (!user || !user.isActive || !user.refreshTokenHash) {
      throw new AppError('Invalid or expired refresh token', StatusCodes.UNAUTHORIZED);
    }

    const isTokenValid = await bcrypt.compare(trimmedRefreshToken, user.refreshTokenHash);
    if (!isTokenValid) {
      throw new AppError('Invalid or expired refresh token', StatusCodes.UNAUTHORIZED);
    }

    return this.issueAndPersistTokens(user);
  }

  public async logout(userId: string): Promise<void> {
    if (!userId || !userId.trim()) {
      throw new AppError('User id is required', StatusCodes.BAD_REQUEST);
    }

    await this.userRepository.updateById(userId.trim(), { refreshTokenHash: null });
  }

  public async forgotPassword(email: string): Promise<void> {
    if (typeof email !== 'string') return;
    const normalized = email.trim().toLowerCase();
    if (!normalized) return;

    const user = await this.userRepository.findByEmail(normalized);
    if (!user || !user.isActive || user.authProvider !== AuthProvider.LOCAL) return;

    await this.passwordResetTokenRepository.deleteOutstanding(
      user.id,
      PasswordResetTokenPurpose.RESET,
    );

    const rawToken = generateRawToken();
    await this.passwordResetTokenRepository.create({
      userId: user.id,
      tokenHash: hashToken(rawToken),
      purpose: PasswordResetTokenPurpose.RESET,
      expiresAt: new Date(Date.now() + RESET_TTL_MS),
    });

    const link = `${env.app.frontendUrl}/reset-password?token=${rawToken}`;
    try {
      await this.mailerService.sendPasswordResetLink({
        to: user.email,
        firstName: user.firstName,
        link,
      });
    } catch (error) {
      console.error('Failed to send password-reset email', {
        email: user.email,
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  public async setPassword(rawToken: string, rawPassword: string): Promise<void> {
    if (typeof rawToken !== 'string' || !rawToken.trim()) {
      throw new AppError('Invalid or expired token', StatusCodes.BAD_REQUEST);
    }
    if (typeof rawPassword !== 'string' || !rawPassword.trim()) {
      throw new AppError('Password is required.', StatusCodes.BAD_REQUEST);
    }

    const tokenHashValue = hashToken(rawToken.trim());
    const tokenRecord = await this.passwordResetTokenRepository.findActiveByHash(tokenHashValue);
    if (!tokenRecord) {
      throw new AppError('Invalid or expired token', StatusCodes.BAD_REQUEST);
    }

    const user = await this.userRepository.findById(tokenRecord.userId);
    if (!user || !user.isActive) {
      throw new AppError('Invalid or expired token', StatusCodes.BAD_REQUEST);
    }

    assertValidPassword(rawPassword, {
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
    });

    const passwordHash = await bcrypt.hash(rawPassword, env.auth.bcryptSaltRounds);
    await this.userRepository.updateById(user.id, { passwordHash });
    await this.passwordResetTokenRepository.markConsumed(tokenRecord.id);
  }

  public async getMe(userId: string): Promise<IAuthUser> {
    if (!userId || !userId.trim()) {
      throw new AppError('User id is required', StatusCodes.BAD_REQUEST);
    }

    const user = await this.userRepository.findById(userId.trim());

    if (!user || !user.isActive) {
      throw new AppError('User not found', StatusCodes.NOT_FOUND);
    }

    return user;
  }

  private generateAccessToken(payload: IAuthTokenPayload): string {
    return jwt.sign(payload, env.auth.jwtSecret, {
      expiresIn: env.auth.jwtExpiresIn,
    } as jwt.SignOptions);
  }

  private generateRefreshToken(payload: IAuthTokenPayload): string {
    return jwt.sign(payload, env.auth.jwtRefreshSecret, {
      expiresIn: env.auth.jwtRefreshExpiresIn,
    } as jwt.SignOptions);
  }

  private async issueAndPersistTokens(user: IAuthUser): Promise<IAuthTokens> {
    const payload: IAuthTokenPayload = {
      userId: user.id,
      email: user.email,
      role: user.role,
    };

    const accessToken = this.generateAccessToken(payload);
    const refreshToken = this.generateRefreshToken(payload);
    const refreshTokenHash = await bcrypt.hash(refreshToken, 10);

    await this.userRepository.updateById(user.id, { refreshTokenHash });

    return { accessToken, refreshToken };
  }

  private getOAuthProviderConfig(provider: OAuthProvider): IOAuthProviderConfig {
    if (provider === 'google') {
      if (!env.auth.oauth.googleClientId || !env.auth.oauth.googleClientSecret) {
        throw new AppError('Google OAuth is not configured', StatusCodes.INTERNAL_SERVER_ERROR);
      }

      return {
        clientId: env.auth.oauth.googleClientId,
        clientSecret: env.auth.oauth.googleClientSecret,
        authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        userInfoUrl: 'https://www.googleapis.com/oauth2/v3/userinfo',
        scope: 'openid email profile',
        redirectUri: `${env.app.baseUrl}/api/${env.app.apiVersion}/auth/oauth/google/callback`,
      };
    }

    if (!env.auth.oauth.microsoftClientId || !env.auth.oauth.microsoftClientSecret) {
      throw new AppError('Microsoft OAuth is not configured', StatusCodes.INTERNAL_SERVER_ERROR);
    }

    return {
    clientId: env.auth.oauth.microsoftClientId,
    clientSecret: env.auth.oauth.microsoftClientSecret,
    authUrl: `https://login.microsoftonline.com/${env.auth.oauth.microsoftTenantId}/oauth2/v2.0/authorize`,
    tokenUrl: `https://login.microsoftonline.com/${env.auth.oauth.microsoftTenantId}/oauth2/v2.0/token`,
    userInfoUrl: 'https://graph.microsoft.com/v1.0/me',
    scope: 'openid profile email User.Read',
    redirectUri: `${env.app.baseUrl}/api/${env.app.apiVersion}/auth/oauth/microsoft/callback`,
  };
  }

  private async exchangeOAuthCodeForProfile(
    provider: OAuthProvider,
    code: string,
  ): Promise<IOAuthProfile> {
    const oauthConfig = this.getOAuthProviderConfig(provider);

    let tokenResponse;
    try {
      tokenResponse = await axios.post(
        oauthConfig.tokenUrl,
        new URLSearchParams({
          code,
          client_id: oauthConfig.clientId,
          client_secret: oauthConfig.clientSecret,
          redirect_uri: oauthConfig.redirectUri,
          grant_type: 'authorization_code',
        }),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 10_000,
        },
      );
    } catch {
      throw new AppError('OAuth token exchange failed', StatusCodes.UNAUTHORIZED);
    }

    const accessToken = tokenResponse.data['access_token'] as string | undefined;
    if (!accessToken) {
      throw new AppError('OAuth token exchange failed', StatusCodes.UNAUTHORIZED);
    }

    if (provider === 'google') {
      let userResponse;
      try {
        userResponse = await axios.get(oauthConfig.userInfoUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
          timeout: 10_000,
        });
      } catch {
        throw new AppError('Failed to fetch OAuth profile', StatusCodes.BAD_GATEWAY);
      }

      const email = userResponse.data['email'] as string | undefined;
      const providerId = userResponse.data['sub'] as string | undefined;
      const emailVerified = userResponse.data['email_verified'] as boolean | undefined;
      const givenName = userResponse.data['given_name'] as string | undefined;
      const familyName = userResponse.data['family_name'] as string | undefined;
      const fullName = (userResponse.data['name'] as string | undefined) ?? '';

      if (!email || !providerId || emailVerified !== true) {
        throw new AppError('Failed to read Google profile', StatusCodes.UNAUTHORIZED);
      }

      const [firstFromFullName, ...lastFromFullNameParts] = fullName.trim().split(' ');
      return {
        email,
        providerId,
        firstName: givenName ?? firstFromFullName ?? 'User',
        lastName: familyName ?? (lastFromFullNameParts.join(' ') || 'OAuth'),
      };
    }

    let userResponse;
    try {
      userResponse = await axios.get(oauthConfig.userInfoUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 10_000,
      });
    } catch {
      throw new AppError('Failed to fetch OAuth profile', StatusCodes.BAD_GATEWAY);
    }

    const email =
      (userResponse.data['mail'] as string | undefined) ??
      (userResponse.data['userPrincipalName'] as string | undefined);
    const providerId = userResponse.data['id'] as string | undefined;
    const givenName = userResponse.data['givenName'] as string | undefined;
    const surname = userResponse.data['surname'] as string | undefined;
    const displayName = (userResponse.data['displayName'] as string | undefined) ?? '';

    if (!email || !providerId) {
      throw new AppError('Failed to read Microsoft profile', StatusCodes.UNAUTHORIZED);
    }

    const [firstFromDisplayName, ...lastFromDisplayNameParts] = displayName.trim().split(' ');
    return {
      email,
      providerId,
      firstName: givenName ?? firstFromDisplayName ?? 'User',
      lastName: surname ?? (lastFromDisplayNameParts.join(' ') || 'OAuth'),
    };
  }
}
