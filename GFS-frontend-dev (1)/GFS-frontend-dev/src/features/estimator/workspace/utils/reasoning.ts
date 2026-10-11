const CONFIDENCE_TAG = /\((?:LOW|MEDIUM|HIGH)\)/gi;
const MACHINE_PREFIX = /^[a-z][a-z0-9_]*(?:\s*=\s*[^:]+)?:\s*/i;

const splitCanonicalReasoning = (reason: string): string =>
  reason.replace(/\[canonical\]/gi, (_marker, offset: number, source: string) => {
    const previousCharacter = source.slice(0, offset).trimEnd().slice(-1);

    // Canonical markers inside parentheses belong to the same sentence.
    return previousCharacter && "([{,:;".includes(previousCharacter) ? " " : "\n";
  });

const parseSerializedReasoningArray = (value: string): string[] | null => {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed.flatMap((item) => (typeof item === "string" ? [item] : []));
    }
  } catch {
    // AI responses can use Python-style quotes and omit commas between items.
  }

  const inner = trimmed.slice(1, -1);
  const items: string[] = [];
  let index = 0;

  while (index < inner.length) {
    while (index < inner.length && /[\s,]/.test(inner[index] ?? "")) index += 1;
    if (index >= inner.length) break;

    const quote = inner[index];
    if (quote !== "'" && quote !== '"') return null;
    index += 1;

    let item = "";
    let closed = false;
    while (index < inner.length) {
      const character = inner[index];

      if (character === "\\" && index + 1 < inner.length) {
        const escaped = inner[index + 1];
        if (escaped === "n") item += "\n";
        else if (escaped === "r") item += "\r";
        else if (escaped === "t") item += "\t";
        else item += escaped;
        index += 2;
        continue;
      }

      if (character === quote) {
        let lookAhead = index + 1;
        while (lookAhead < inner.length && /\s/.test(inner[lookAhead] ?? "")) lookAhead += 1;
        if (
          lookAhead === inner.length ||
          inner[lookAhead] === "," ||
          inner[lookAhead] === "'" ||
          inner[lookAhead] === '"'
        ) {
          index += 1;
          closed = true;
          break;
        }
      }

      item += character;
      index += 1;
    }

    if (!closed) return null;
    items.push(item);

    while (index < inner.length && /\s/.test(inner[index] ?? "")) index += 1;
    if (inner[index] === ",") index += 1;
  }

  return items.length > 0 ? items : null;
};

const flattenReasoning = (reason: unknown): string[] => {
  if (!reason) return [];

  if (Array.isArray(reason)) {
    return reason.flatMap(flattenReasoning);
  }

  if (typeof reason === "object") {
    return Object.values(reason as Record<string, unknown>).flatMap(flattenReasoning);
  }

  const text = String(reason);
  const serializedItems = parseSerializedReasoningArray(text);
  if (serializedItems) return serializedItems.flatMap(flattenReasoning);

  return splitCanonicalReasoning(text)
    .split(/\n+/);
};

const sentenceCase = (value: string): string => {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
};

const cleanLine = (line: string): string => {
  const cleaned = line
    .replace(/^[-*]\s*/, "")
    .replace(CONFIDENCE_TAG, "")
    .replace(/\s*\|\s*/g, ". ")
    .replace(MACHINE_PREFIX, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.])/g, "$1")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/^['"]|['"]$/g, "")
    .trim();

  if (!cleaned) return "";

  const withReadableKeys = cleaned.replace(/_/g, " ");
  const withPeriod = /[.!?]$/.test(withReadableKeys) ? withReadableKeys : `${withReadableKeys}.`;

  return sentenceCase(withPeriod);
};

export const formatReasoningLines = (reason: unknown): string[] => {
  const seen = new Set<string>();

  return flattenReasoning(reason)
    .map(cleanLine)
    .filter((line) => {
      if (!line || seen.has(line)) return false;
      seen.add(line);
      return true;
    });
};
