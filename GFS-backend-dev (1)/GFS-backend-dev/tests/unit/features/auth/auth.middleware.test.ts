import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { UserRole } from '@db/models/user.model';

let authenticate: (req: Request, res: Response, next: NextFunction) => void;
let authorize: (...roles: UserRole[]) => (req: Request, res: Response, next: NextFunction) => void;

beforeAll(async () => {
  process.env['JWT_SECRET'] = process.env['JWT_SECRET'] ?? 'test-access-secret';
  process.env['JWT_REFRESH_SECRET'] = process.env['JWT_REFRESH_SECRET'] ?? 'test-refresh-secret';
  process.env['MONGODB_URI'] = process.env['MONGODB_URI'] ?? 'mongodb://localhost:27017/gfs-test';

  const middleware = await import('@features/auth/auth.middleware.js');
  authenticate = middleware.authenticate;
  authorize = middleware.authorize;
});

const mockNext = jest.fn() as jest.MockedFunction<NextFunction>;
const mockRes = {} as Response;

const buildReq = (cookies: Record<string, string> = {}): Request =>
  ({ cookies } as unknown as Request);

describe('authenticate', () => {
  it('attaches user to req and calls next on valid token', () => {
    const payload = {
      userId: 'user-id-123',
      email: 'estimator@gfs.com',
      role: UserRole.ESTIMATOR,
    };

    const token = jwt.sign(payload, process.env['JWT_SECRET'] as string, { expiresIn: '15m' });

    const req = buildReq({ accessToken: token });
    authenticate(req, mockRes, mockNext);

    expect(req.user).toEqual(payload);
    expect(mockNext).toHaveBeenCalledWith();
  });

  it('calls next with 401 when no cookie present', () => {
    const req = buildReq({});
    authenticate(req, mockRes, mockNext);

    expect(mockNext).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 401 }),
    );
  });

  it('calls next with 401 when token is invalid', () => {
    const req = buildReq({ accessToken: 'not-a-valid-jwt' });
    authenticate(req, mockRes, mockNext);

    expect(mockNext).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 401 }),
    );
  });

  it('calls next with 401 when token is expired', () => {
    const token = jwt.sign(
      { userId: 'user-id-123', email: 'estimator@gfs.com', role: UserRole.ESTIMATOR },
      process.env['JWT_SECRET'] as string,
      { expiresIn: -1 },
    );

    const req = buildReq({ accessToken: token });
    authenticate(req, mockRes, mockNext);

    expect(mockNext).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 401 }),
    );
  });
});

describe('authorize', () => {
  it('calls next when user role matches', () => {
    const req = {
      user: { userId: 'id', email: 'admin@gfs.com', role: UserRole.SYSTEM_ADMIN },
    } as unknown as Request;

    authorize(UserRole.SYSTEM_ADMIN)(req, mockRes, mockNext);

    expect(mockNext).toHaveBeenCalledWith();
  });

  it('calls next with 403 when role does not match', () => {
    const req = {
      user: { userId: 'id', email: 'estimator@gfs.com', role: UserRole.ESTIMATOR },
    } as unknown as Request;

    authorize(UserRole.SYSTEM_ADMIN)(req, mockRes, mockNext);

    expect(mockNext).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 403 }),
    );
  });

  it('calls next with 403 when no user on req', () => {
    const req = {} as Request;

    authorize(UserRole.SYSTEM_ADMIN)(req, mockRes, mockNext);

    expect(mockNext).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 403 }),
    );
  });

  it('passes when user has one of multiple allowed roles', () => {
    const req = {
      user: { userId: 'id', email: 'sales@gfs.com', role: UserRole.SALES_MANAGER },
    } as unknown as Request;

    authorize(UserRole.ESTIMATOR, UserRole.SALES_MANAGER)(req, mockRes, mockNext);

    expect(mockNext).toHaveBeenCalledWith();
  });

  it('calls next with 403 when ESTIMATOR tries SYSTEM_ADMIN route', () => {
    const req = {
      user: { userId: 'id', email: 'estimator@gfs.com', role: UserRole.ESTIMATOR },
    } as unknown as Request;

    authorize(UserRole.SYSTEM_ADMIN)(req, mockRes, mockNext);

    expect(mockNext).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 403 }),
    );
  });

  it.each([UserRole.SYSTEM_ADMIN, UserRole.SALES_MANAGER, UserRole.ESTIMATOR])(
    'lets HEAD_OF_DIVISION through a %s route',
    (role) => {
      const req = {
        user: { userId: 'id', email: 'hod@gfs.com', role: UserRole.HEAD_OF_DIVISION },
      } as unknown as Request;

      authorize(role)(req, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
    },
  );

  it('calls next with 403 when HEAD_OF_DIVISION tries a SUPER_ADMIN-only route', () => {
    const req = {
      user: { userId: 'id', email: 'hod@gfs.com', role: UserRole.HEAD_OF_DIVISION },
    } as unknown as Request;

    authorize(UserRole.SUPER_ADMIN)(req, mockRes, mockNext);

    expect(mockNext).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 403 }),
    );
  });

  it('calls next with 403 when SYSTEM_ADMIN tries a HEAD_OF_DIVISION-only route', () => {
    const req = {
      user: { userId: 'id', email: 'admin@gfs.com', role: UserRole.SYSTEM_ADMIN },
    } as unknown as Request;

    authorize(UserRole.HEAD_OF_DIVISION)(req, mockRes, mockNext);

    expect(mockNext).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 403 }),
    );
  });
});
