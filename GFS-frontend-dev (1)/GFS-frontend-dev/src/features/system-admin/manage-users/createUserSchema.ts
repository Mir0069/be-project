import { z } from "zod";

export const createUserSchema =
  z.object({
    firstName: z
      .string()
      .trim()
      .nonempty(
        "First name is required"
      )
      .min(
        2,
        "First name must be at least 2 characters"
      ),

    lastName: z
      .string()
      .trim()
      .nonempty(
        "Last name is required"
      )
      .min(
        2,
        "Last name must be at least 2 characters"
      ),

    email: z
      .string()
      .trim()
      .nonempty(
        "Email is required"
      )
      .email(
        "Incorrect email format"
      ),

    role: z.enum(
      [
        "ESTIMATOR",
        "SALES_MANAGER",
        "SUPER_ADMIN",
        "SYSTEM_ADMIN",
        "HEAD_OF_DIVISION",
      ],
      {
        message:
          "Role is required",
      }
    ),
  });