import { Router, type Request } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { authenticate, authorize } from './auth.middleware';
import { asyncHandler } from '@shared/utils/async-handler';
import { validateRequest } from '@shared/middleware/validate.middleware';
import { userRepository, passwordResetTokenRepository } from '@repositories/index';
import { mailerService } from '@shared/mailer/index';
import { UserRole } from '@db/models/user.model';
import { env } from '@config/index';
import { forgotPasswordSchema, registerSchema, setPasswordSchema } from './auth.validation';

const authService = new AuthService(
  userRepository,
  passwordResetTokenRepository,
  mailerService,
);
const authController = new AuthController(authService);

const router = Router();

const authRateLimitKey = (req: Request): string => {
  const email = typeof req.body?.email === 'string'
    ? req.body.email.trim().toLowerCase().slice(0, 256)
    : 'unknown';
  return `${ipKeyGenerator(req.ip ?? 'unknown')}:${email}`;
};

const loginRateLimiter = rateLimit({
  windowMs: env.rateLimit.loginWindowMs,
  max: env.rateLimit.loginMaxAttempts,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  skip: () => env.app.nodeEnv !== 'production',
  keyGenerator: authRateLimitKey,
  message: { success: false, message: 'Too many failed login attempts. Please try again later.' },
});

const forgotPasswordRateLimiter = rateLimit({
  windowMs: env.rateLimit.forgotPasswordWindowMs,
  max: env.rateLimit.forgotPasswordMaxAttempts,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => env.app.nodeEnv !== 'production',
  keyGenerator: authRateLimitKey,
  message: { success: false, message: 'Too many password-reset requests. Please try again later.' },
});

router.post(
  '/register',
  authenticate,
  authorize(UserRole.SYSTEM_ADMIN),
  validateRequest(registerSchema),
  asyncHandler((req, res) => authController.register(req, res)),
);
router.post('/login', loginRateLimiter, asyncHandler((req, res) => authController.login(req, res)));
router.post('/refresh-token', asyncHandler((req, res) => authController.refresh(req, res)));
router.post('/logout', authenticate, asyncHandler((req, res) => authController.logout(req, res)));
router.post(
  '/forgot-password',
  forgotPasswordRateLimiter,
  validateRequest(forgotPasswordSchema),
  asyncHandler((req, res) => authController.forgotPassword(req, res)),
);
router.post(
  '/set-password',
  validateRequest(setPasswordSchema),
  asyncHandler((req, res) => authController.setPassword(req, res)),
);
router.get('/me', authenticate, asyncHandler((req, res) => authController.getMe(req, res)));
router.get('/oauth/:provider', asyncHandler((req, res) => authController.oauthRedirect(req, res)));
router.get('/oauth/:provider/callback', asyncHandler((req, res) => authController.oauthCallback(req, res)));

export default router;
