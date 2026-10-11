export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_BYTES = 72;

export type PasswordPolicyContext = {
  email?: string;
  firstName?: string;
  lastName?: string;
};

export type PasswordPolicyChecks = {
  minLength: boolean;
  maxBytes: boolean;
  lowercase: boolean;
  uppercase: boolean;
  number: boolean;
  special: boolean;
  complexity: boolean;
  notCommon: boolean;
  noPersonalInfo: boolean;
};

const COMMON_PASSWORDS = new Set([
  "12345678",
  "123456789",
  "1234567890",
  "admin",
  "admin123",
  "changeme",
  "iloveyou",
  "letmein",
  "passw0rd",
  "password",
  "password1",
  "password123",
  "qwerty",
  "qwerty123",
  "welcome",
  "welcome123",
]);

const normalizeForComparison = (value: string): string =>
  value.toLocaleLowerCase().replace(/[^a-z0-9]/g, "");

const PERSONAL_FRAGMENT_MIN_LENGTH = 4;

const personalTokens = (context: PasswordPolicyContext): string[] => {
  const identityValues = [
    context.email?.split("@")[0] ?? "",
    context.firstName ?? "",
    context.lastName ?? "",
  ];

  return Array.from(
    new Set(
      identityValues.flatMap((value) => {
        const normalizedValue = normalizeForComparison(value);
        if (normalizedValue.length < 3) return [];

        const tokens = [normalizedValue];
        for (let index = 0; index <= normalizedValue.length - PERSONAL_FRAGMENT_MIN_LENGTH; index += 1) {
          tokens.push(normalizedValue.slice(index, index + PERSONAL_FRAGMENT_MIN_LENGTH));
        }
        return tokens;
      }),
    ),
  );
};

export const getPasswordPolicyChecks = (
  password: string,
  context: PasswordPolicyContext = {},
): PasswordPolicyChecks => {
  const hasLowercase = /[a-z]/.test(password);
  const hasUppercase = /[A-Z]/.test(password);
  const hasNumber = /\d/.test(password);
  const hasSpecial = /[^A-Za-z0-9\s]/.test(password);
  const normalizedPassword = normalizeForComparison(password);

  return {
    minLength: Array.from(password).length >= PASSWORD_MIN_LENGTH,
    maxBytes: new TextEncoder().encode(password).length <= PASSWORD_MAX_BYTES,
    lowercase: hasLowercase,
    uppercase: hasUppercase,
    number: hasNumber,
    special: hasSpecial,
    complexity: [hasLowercase, hasUppercase, hasNumber, hasSpecial].every(Boolean),
    notCommon: !COMMON_PASSWORDS.has(normalizedPassword),
    noPersonalInfo: !personalTokens(context).some((token) => normalizedPassword.includes(token)),
  };
};

export const getPasswordPolicyErrors = (
  password: string,
  context: PasswordPolicyContext = {},
): string[] => {
  if (!password) return ["Password is required."];

  const checks = getPasswordPolicyChecks(password, context);
  const errors: string[] = [];

  if (!checks.minLength) {
    errors.push(`Password must be at least ${PASSWORD_MIN_LENGTH} characters long.`);
  }
  if (!checks.maxBytes) {
    errors.push(`Password must not exceed ${PASSWORD_MAX_BYTES} UTF-8 bytes.`);
  }
  if (!checks.complexity) {
    errors.push("Password must include at least one uppercase letter, one lowercase letter, one number, and one special character.");
  }
  if (!checks.notCommon) {
    errors.push("Password is too common. Choose a less predictable password.");
  }
  if (!checks.noPersonalInfo) {
    errors.push("Password must not contain your name or email address.");
  }

  return errors;
};

export const isPasswordPolicyValid = (
  password: string,
  context: PasswordPolicyContext = {},
): boolean => getPasswordPolicyErrors(password, context).length === 0;
