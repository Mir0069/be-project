import { MULTI_UNIT_FRAME_TYPES } from './multi-unit.contract';

/**
 * Frame-family rules for AI pushes. Switching family (Series 2000 to Series
 * 3000, EconoFrame to Perimeter) changes the price materially, so the AI may
 * only do it when a document cites the new family or the change the estimator
 * approved names it in writing.
 */

const CANONICAL_FRAME_TYPES = new Set<string>(MULTI_UNIT_FRAME_TYPES);

export const isCanonicalFrameType = (value: unknown): value is string =>
  typeof value === 'string' && CANONICAL_FRAME_TYPES.has(value);

/** Series 1000/2000 variants share a family; every other code is its own family. */
export const frameFamilyOf = (value: string): string => {
  if (value.includes('SERIES_1000')) return 'SERIES_1000';
  if (value.includes('SERIES_2000')) return 'SERIES_2000';
  return value;
};

/** True when the AI's stated-frame signal cites a document that names this family. */
export const hasCitedStatedFrameFamily = (signal: any, frameType: string): boolean => {
  if (!signal || typeof signal !== 'object' || frameFamilyOf(String(signal.value ?? '')) !== frameFamilyOf(frameType)) {
    return false;
  }

  const citation = signal.citation ?? signal.extracted_citation;
  if (!citation || typeof citation !== 'object') return false;

  return Boolean(
    (citation.bbox_inches ?? citation.bbox) &&
    (citation.pdf_name ?? citation.doc_name ?? citation.pdfName ?? citation.docName),
  );
};

const seriesPattern = (number: string): RegExp =>
  new RegExp(`\\b(?:series|s)\\s*[-#]?\\s*${number}\\b|\\b${number}\\s*series\\b`, 'i');

/** How people write each family in notes and chats. MANUAL is never authorised by text. */
const FAMILY_MENTIONS: ReadonlyArray<readonly [string, RegExp]> = [
  ['SERIES_1000', seriesPattern('1000')],
  ['SERIES_2000', seriesPattern('2000')],
  ['SERIES_3000', seriesPattern('3000')],
  ['ECONOFRAME', /\beco(?:no)?\s*-?\s*frame\b|\be-?frame\b/i],
  ['PERIMETER_NON_TB', /\bperimeter\b[^.\n]{0,40}\b(?:non[\s-]*(?:thermally[\s-]*)?(?:broken|tb)|ntb)\b|\bnon[\s-]*thermally[\s-]*broken\b/i],
  ['DECK_PERIMETER', /\bdeck\s+perimeter\b/i],
  ['ROUND_FRAME_42', /\bround\s+frame\b/i],
];

/** Frame families the text explicitly names. */
export const frameFamiliesNamedIn = (text: string | null | undefined): Set<string> => {
  const named = new Set<string>();
  if (!text) return named;
  for (const [family, pattern] of FAMILY_MENTIONS) {
    if (pattern.test(text)) named.add(family);
  }
  return named;
};

/** True when an approved instruction names the family of the incoming frame. */
export const instructionNamesFrameFamily = (instruction: string | null | undefined, frameType: string): boolean =>
  frameFamiliesNamedIn(instruction).has(frameFamilyOf(frameType));

/**
 * The rules engine derives these from the frame it chose. When that frame is
 * rejected they describe a frame the project does not have, so they go too.
 */
export const dropFrameDerivedFields = (stage3: any): string[] => {
  const dropped: string[] = [];
  const decision = stage3?.decision;
  for (const key of ['proposal_number', 'assembly_type']) {
    if (decision && key in decision) {
      delete decision[key];
      dropped.push(`stage_3.decision.${key}`);
    }
  }
  const installType = stage3?._signals?.install_type;
  if (installType && typeof installType === 'object' && installType.updated_by === 'rules_engine') {
    delete stage3._signals.install_type;
    dropped.push('stage_3._signals.install_type');
  }
  return dropped;
};
