/**
 * quote-number.engine.ts
 *
 */

const REFERENCE_NUMBER_REGEX = /^GFS-(\d{4})-(\d{4})$/;
const QUOTE_NUMBER_REGEX = /^(\d{8})([A-Z])?$/;

export class InvalidReferenceNumberError extends Error {
  constructor(referenceNumber: string) {
    super(`Invalid project reference number: "${referenceNumber}". Expected GFS-YYYY-NNNN.`);
    this.name = 'InvalidReferenceNumberError';
  }
}

export class InvalidQuoteNumberError extends Error {
  constructor(quoteNumber: string) {
    super(`Invalid quote number: "${quoteNumber}". Expected 8 digits optionally followed by one uppercase letter.`);
    this.name = 'InvalidQuoteNumberError';
  }
}

export class MaxRevisionsExceededError extends Error {
  constructor() {
    super('Maximum number of revisions (Z) reached for this quote.');
    this.name = 'MaxRevisionsExceededError';
  }
}

export class ReferenceNumberMismatchError extends Error {
  constructor(quoteBase: string, referenceBase: string) {
    super(
      `Existing quote number base "${quoteBase}" does not match the project's ` +
        `reference number base "${referenceBase}". Refusing to generate a revision ` +
        `off a quote number that doesn't belong to this project.`,
    );
    this.name = 'ReferenceNumberMismatchError';
  }
}

/**
 * Derives the 8-digit base quote number from a project's reference number.
 * "GFS-2026-1012" -> "20261012"
 */
export function deriveBaseQuoteNumber(referenceNumber: string): string {
  const match = referenceNumber.trim().match(REFERENCE_NUMBER_REGEX);
  if (!match) {
    throw new InvalidReferenceNumberError(referenceNumber);
  }
  const [, year, sequence] = match;
  return `${year}${sequence}`;
}

/**
 * Splits an existing quote number into its base and revision letter (if any).
 * "20261012"  -> { base: "20261012", revisionLetter: null }
 * "20261012A" -> { base: "20261012", revisionLetter: "A" }
 */
export function parseQuoteNumber(quoteNumber: string): { base: string; revisionLetter: string | null } {
  const match = quoteNumber.trim().match(QUOTE_NUMBER_REGEX);
  if (!match) {
    throw new InvalidQuoteNumberError(quoteNumber);
  }
  const [, base, letter] = match;
  return { base: base!, revisionLetter: letter ?? null };
}

/**
 * Given the current revision letter (or null for "no revisions yet"),
 * returns the next letter in sequence. "A" is the first revision letter.
 * Throws once "Z" is exceeded — the convention doc doesn't define double letters.
 */
export function nextRevisionLetter(currentLetter: string | null): string {
  if (!currentLetter) {
    return 'A';
  }
  if (currentLetter === 'Z') {
    throw new MaxRevisionsExceededError();
  }
  return String.fromCharCode(currentLetter.charCodeAt(0) + 1);
}

/**
 * Computes the quote number that should be assigned the NEXT time a quote is
 * issued for this project, based on its current state.
 *
 *   project.quoteNumber === null/undefined -> first-ever quote -> base only
 *   project.quoteNumber === "<base>"       -> first revision   -> base + "A"
 *   project.quoteNumber === "<base>X"      -> next revision    -> base + next(X)
 *
 * Throws if the project's existing quoteNumber doesn't match its own
 * referenceNumber (defensive check against stale/copied data).
 */
export function generateNextQuoteNumber(project: {
  referenceNumber: string;
  quoteNumber?: string | null;
}): string {
  const expectedBase = deriveBaseQuoteNumber(project.referenceNumber);

  if (!project.quoteNumber) {
    return expectedBase;
  }

  const { base: existingBase, revisionLetter } = parseQuoteNumber(project.quoteNumber);

  if (existingBase !== expectedBase) {
    throw new ReferenceNumberMismatchError(existingBase, expectedBase);
  }

  return `${expectedBase}${nextRevisionLetter(revisionLetter)}`;
}