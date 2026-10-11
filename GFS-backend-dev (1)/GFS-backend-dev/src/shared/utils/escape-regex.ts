/**
 * Escapes special characters in a string so it can be safely used within a regular expression.
 * This prevents Regular Expression Denial of Service (ReDoS) attacks and syntax errors
 * when constructing dynamic regex patterns from user input.
 * 
 * @param text The input string to escape
 * @returns The safely escaped string
 */
export function escapeRegex(text: string): string {
  if (!text) return '';
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
