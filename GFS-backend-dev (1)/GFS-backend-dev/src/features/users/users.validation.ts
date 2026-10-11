import { z } from 'zod';
import { UserRole } from '@db/models/user.model';

export const createUserSchema = z.object({
  body: z.object({
    firstName: z.string().trim().min(1, 'required'),
    lastName: z.string().trim().min(1, 'required'),
    email: z.string().trim().toLowerCase().email('must be a valid email'),
    role: z.enum([UserRole.ESTIMATOR, UserRole.SALES_MANAGER, UserRole.HEAD_OF_DIVISION], {
      message: `role must be valid`,
    }),
  }),
});

export const editUserSchema = z.object({
  body: z.object({
    firstName: z.string().trim().min(1, 'required'),
    lastName: z.string().trim().min(1, 'required'),
    role: z.enum([UserRole.ESTIMATOR, UserRole.SALES_MANAGER, UserRole.HEAD_OF_DIVISION], {
      message: `role must be valid`,
    }),
  }),
});
