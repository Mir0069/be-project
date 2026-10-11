// features/auth/validation/loginSchema.ts

import { z } from "zod";
import { getPasswordPolicyErrors } from "./passwordPolicy";

export const registerSchema = z
  .object({
    firstName: z
      .string()
      .trim()
      .nonempty("First name is required")
      .min(2, "First name must be at least 2 characters"),

    lastName: z
      .string()
      .trim()
      .nonempty("Last name is required")
      .min(2, "Last name must be at least 2 characters"),

    email: z
      .string()
      .trim()
      .nonempty("Email is required")
      .refine((val: any) => !val || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val), {
        message: "Incorrect email format",
      }),

    password: z.string().nonempty("Password is required"),

    confirmPassword: z.string().nonempty("Confirm password is required"),

    role: z.enum(["ESTIMATOR", "SALES_MANAGER", "SYSTEM_ADMIN"], {
      message: "Role is required",
    }),
  })

  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  })
  .superRefine((data, context) => {
    if (!data.password) return;

    getPasswordPolicyErrors(data.password, {
      email: data.email,
      firstName: data.firstName,
      lastName: data.lastName,
    }).forEach((message) => {
      context.addIssue({ code: "custom", message, path: ["password"] });
    });
  });
