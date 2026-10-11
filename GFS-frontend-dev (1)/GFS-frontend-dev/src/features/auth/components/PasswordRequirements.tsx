import { Check, Circle, X } from "lucide-react";
import {
  getPasswordPolicyChecks,
  PASSWORD_MAX_BYTES,
  PASSWORD_MIN_LENGTH,
  type PasswordPolicyContext,
} from "@/features/auth/validation/passwordPolicy";

type Props = PasswordPolicyContext & {
  password: string;
};

const PasswordRequirements = ({ password, email, firstName, lastName }: Props) => {
  const checks = getPasswordPolicyChecks(password, { email, firstName, lastName });
  const hasInput = password.length > 0;
  const rows = [
    {
      label: `At least ${PASSWORD_MIN_LENGTH} characters`,
      valid: checks.minLength,
    },
    {
      label: "Uppercase, lowercase, number, and special character",
      valid: checks.complexity,
    },
    {
      label: "Not a common password or personal information",
      valid: checks.notCommon && checks.noPersonalInfo,
    },
    {
      label: `Maximum ${PASSWORD_MAX_BYTES} UTF-8 bytes`,
      valid: checks.maxBytes,
    },
  ];

  return (
    <div
      aria-live="polite"
      className="mt-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600"
    >
      <p className="mb-1 font-semibold text-gray-700">Password requirements</p>
      <div className="grid gap-1 sm:grid-cols-2">
        {rows.map((row) => {
          const Icon = !hasInput ? Circle : row.valid ? Check : X;
          const color = !hasInput
            ? "text-gray-400"
            : row.valid
              ? "text-emerald-600"
              : "text-red-500";

          return (
            <div key={row.label} className="flex items-start gap-1.5">
              <Icon size={13} className={`mt-0.5 shrink-0 ${color}`} aria-hidden="true" />
              <span>{row.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default PasswordRequirements;
