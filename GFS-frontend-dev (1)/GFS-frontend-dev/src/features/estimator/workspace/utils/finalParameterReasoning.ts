import { formatReasoningLines } from "./reasoning";

export const FINAL_PARAMETER_REASONING_MAX_POINTS = 3;

type FinalParameterReasoningOptions = {
  reason: unknown;
  fallback: string;
  label: string;
  citation?: unknown;
};

const PDF_FILENAME_PATTERN = /(?:^|[\s"'([{])([^\\/:*?"<>|]+?\.pdf)(?=$|[\s)\]};,!?\.])/i;
const SOURCE_PREFIX_PATTERN = /^(?:source|citation|document|file)\s*:/i;
const SOURCE_MARKER_PATTERN = /(?:source|citation|document|file)\s*:/i;
const MACHINE_PREFIX_PATTERN = /^(?:ai analysis|system|reasoning|evidence|basis|calculation)\s*:\s*/i;
const FORMULA_KEY_PATTERN = /\s+(?=(?:perim(?:eter)?|rafters?|weight|silicone|man\s*hours?|panel(?:\s+count)?|width|length)\s*[:=])/i;

const asCitationText = (value: unknown): string | undefined => {
  if (typeof value === "string") {
    const basename = value.trim().split(/[\\/]/).pop() ?? value.trim();
    const match = basename.match(PDF_FILENAME_PATTERN);
    return match?.[1]?.trim();
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const citation = asCitationText(item);
      if (citation) return citation;
    }
    return undefined;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["pdf_name", "filename", "fileName", "originalName", "name", "citation"]) {
      const citation = asCitationText(record[key]);
      if (citation) return citation;
    }
  }

  return undefined;
};

const normalizeKey = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const ensureSentence = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const readable = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(readable) ? readable : `${readable}.`;
};

const cleanPoint = (value: string, label: string): string => {
  const escapedLabel = label
    .split(/\s+/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[ _]+");
  const withoutMachinePrefix = value
    .replace(MACHINE_PREFIX_PATTERN, "")
    .replace(new RegExp(`^(?:calculated[.:]?[ _]*)?${escapedLabel}\\s*[:=-]\\s*`, "i"), "")
    .replace(/\bsqft\b/gi, "sq ft")
    .replace(/\s*;\s*/g, ". ")
    .replace(/\s+/g, " ")
    .trim();

  return ensureSentence(withoutMachinePrefix);
};

const splitPoint = (value: string): string[] =>
  value
    .split(FORMULA_KEY_PATTERN)
    .flatMap((part) => part.split(/(?<=[!?])\s+(?=[A-Z0-9])/))
    .map((part) => part.trim())
    .filter(Boolean);

const addUniquePoint = (points: string[], point: string): void => {
  const key = normalizeKey(point);
  if (!key) return;

  const duplicateIndex = points.findIndex((existing) => {
    const existingKey = normalizeKey(existing);
    return existingKey === key || existingKey.includes(key) || key.includes(existingKey);
  });

  if (duplicateIndex === -1) {
    points.push(point);
  } else if (point.length > points[duplicateIndex].length) {
    points[duplicateIndex] = point;
  }
};

const compactPoints = (points: string[], maxPoints: number): string[] => {
  if (points.length <= maxPoints) return points;

  const head = points.slice(0, maxPoints - 1);
  const remainder = ensureSentence(points.slice(maxPoints - 1).join(" "));
  return [...head, remainder];
};

export const formatFinalParameterReasoning = ({
  reason,
  fallback,
  label,
  citation,
}: FinalParameterReasoningOptions): string[] => {
  const points: string[] = [];
  let sourceFilename = asCitationText(citation);

  for (const line of formatReasoningLines(reason)) {
    const lineCitation = asCitationText(line);
    if (lineCitation) sourceFilename = sourceFilename ?? lineCitation;
    if (SOURCE_PREFIX_PATTERN.test(line)) continue;

    const sourceIndex = line.search(SOURCE_MARKER_PATTERN);
    const withoutFilename = sourceIndex >= 0
      ? line.slice(0, sourceIndex)
      : lineCitation
        ? line.replace(lineCitation, "")
        : line;
    for (const part of splitPoint(withoutFilename)) {
      addUniquePoint(points, cleanPoint(part, label));
    }
  }

  if (points.length === 0) addUniquePoint(points, cleanPoint(fallback, label));

  const contentPoints = compactPoints(
    points,
    sourceFilename ? FINAL_PARAMETER_REASONING_MAX_POINTS - 1 : FINAL_PARAMETER_REASONING_MAX_POINTS,
  );

  return sourceFilename
    ? [...contentPoints, `Source: ${sourceFilename}`]
    : contentPoints;
};
