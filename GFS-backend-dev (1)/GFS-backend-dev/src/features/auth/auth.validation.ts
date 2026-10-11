import { z } from 'zod';

export const forgotPasswordSchema = z.object({
  body: z.object({
    email: z.string().trim().toLowerCase().email('must be a valid email'),
  }),
});

export const registerSchema = z.object({
  body: z.object({
    email: z.string().trim().toLowerCase().email('must be a valid email'),
    password: z.string().min(1, 'is required'),
    firstName: z.string().trim().min(1, 'is required'),
    lastName: z.string().trim().min(1, 'is required'),
    role: z.string().min(1, 'is required'),
  }),
});

export const setPasswordSchema = z.object({
  body: z.object({
    token: z.string().min(1, 'required'),
    password: z.string().min(1, 'is required'),
  }),
});
