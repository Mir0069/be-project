const PHONE_NUMBER_PATTERN = /(?:\+\d{1,3}[\s-]?)?(?:\(\d{2,4}\)|\d{2,4})[\s.-]\d{3,4}[\s.-]\d{4}/g;

/**
 * Split phone values received from AI, CRM, or a human edit into individual
 * display values. The proposal schema stores the result as one newline-
 * separated string so it remains compatible with the existing scalar field
 * and Excel cell while retaining every number.
 */
export const splitPhoneValues = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.flatMap((item) => splitPhoneValues(item));
  }

  const text = value == null ? '' : String(value).trim();
  if (!text) return [];

  const chunks = text
    .split(/[\n;,/]+|\s+(?:and|or|&)\s+/i)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  return chunks.flatMap((chunk) => {
    const matches = chunk.match(PHONE_NUMBER_PATTERN);
    return matches && matches.length > 0 ? matches : [chunk];
  });
};

export const normalizePhoneValue = (value: unknown): string | null => {
  const values = splitPhoneValues(value).filter(Boolean);
  if (values.length === 0) return null;

  // Do not show the same source number twice when CRM and email extraction
  // contributed the same value in different formats.
  const uniqueValues = [...new Set(values)];
  return uniqueValues.join('\n');
};
