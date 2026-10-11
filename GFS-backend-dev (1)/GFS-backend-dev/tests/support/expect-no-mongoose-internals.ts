const DISALLOWED_INTERNAL_KEY_PATTERNS = [/^__/, /^\$__/, /^_doc$/];

export const expectNoMongooseInternals = (value: unknown, path = 'response'): void => {
  if (value === null || value === undefined) {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      expectNoMongooseInternals(item, `${path}[${index}]`);
    });
    return;
  }

  if (typeof value !== 'object') {
    return;
  }

  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (DISALLOWED_INTERNAL_KEY_PATTERNS.some((pattern) => pattern.test(key))) {
      throw new Error(`Found Mongoose internal key at ${path}.${key}`);
    }
  }

  for (const [key, nested] of Object.entries(record)) {
    expectNoMongooseInternals(nested, `${path}.${key}`);
  }
};
