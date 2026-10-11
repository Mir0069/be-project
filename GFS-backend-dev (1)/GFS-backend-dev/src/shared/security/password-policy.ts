import { StatusCodes } from 'http-status-codes';
import { AppError } from '@shared/errors/app.error';

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_BYTES = 72;

export type PasswordPolicyContext = {
  email?: string;
  firstName?: string;
  lastName?: string;
};

const COMMON_PASSWORDS = new Set([
  '12345678',
  '123456789',
  '1234567890',
  'admin',
  'admin123',
  'changeme',
  'iloveyou',
  'letmein',
  'passw0rd',
  'password',
  'password1',
  'password123',
  'qwerty',
  'qwerty123',
  'welcome',
  'welcome123',
]);

const normalizeForComparison = (value: string): string =>
  value.toLocaleLowerCase().replace(/[^a-z0-9]/g, '');

const PERSONAL_FRAGMENT_MIN_LENGTH = 4;

const personalTokens = (context: PasswordPolicyContext): string[] => {
  const identityValues = [
    context.email?.split('@')[0] ?? '',
    context.firstName ?? '',
    context.lastName ?? '',
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

export const getPasswordPolicyErrors = (
  password: unknown,
  context: PasswordPolicyContext = {},
): string[] => {
  if (typeof password !== 'string' || password.length === 0) {
    return ['Password is required.'];
  }

  const errors: string[] = [];
  const characterTypes = [
    /[a-z]/.test(password),
    /[A-Z]/.test(password),
    /\d/.test(password),
    /[^A-Za-z0-9\s]/.test(password),
  ].filter(Boolean).length;

  if (Array.from(password).length < PASSWORD_MIN_LENGTH) {
    errors.push(`Password must be at least ${PASSWORD_MIN_LENGTH} characters long.`);
  }

  if (Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES) {
    errors.push(`Password must not exceed ${PASSWORD_MAX_BYTES} UTF-8 bytes.`);
  }

  if (characterTypes < 4) {
    errors.push('Password must include at least one uppercase letter, one lowercase letter, one number, and one special character.');
  }

  const normalizedPassword = normalizeForComparison(password);
  if (COMMON_PASSWORDS.has(normalizedPassword)) {
    errors.push('Password is too common. Choose a less predictable password.');
  }

  if (personalTokens(context).some((token) => normalizedPassword.includes(token))) {
    errors.push('Password must not contain your name or email address.');
  }

  return errors;
};

export const assertValidPassword = (
  password: unknown,
  context: PasswordPolicyContext = {},
): void => {
  const errors = getPasswordPolicyErrors(password, context);
  if (errors.length > 0) {
    throw new AppError(errors.join(' '), StatusCodes.BAD_REQUEST);
  }
};
