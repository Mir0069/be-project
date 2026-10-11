// features/auth/validation/loginSchema.ts

import { z } from "zod";

export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .nonempty("Email is required")
    .refine((val: any) => !val || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val), {
      message: "Incorrect email format",
    }),

  password: z.string().nonempty("Password is required"),
});
