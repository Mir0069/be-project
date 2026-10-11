import { z } from "zod";
import { getPasswordPolicyErrors } from "@/features/auth/validation/passwordPolicy";

export const setPasswordSchema =
  z.object({

    password: z.string().nonempty("Password is required"),

    confirmPassword: z.string().nonempty("Confirm password is required"),

  })

    .refine(
      (data) =>
        data.password ===
        data.confirmPassword,
      {
        message:
          "Passwords do not match",

        path: [
          "confirmPassword",
        ],
      }
    )
    .superRefine((data, context) => {
      if (!data.password) return;

      getPasswordPolicyErrors(data.password).forEach((message) => {
        context.addIssue({ code: "custom", message, path: ["password"] });
      });
    });

