export interface Trigger {
  /** Offset in the line where the `:` starts. */
  start: number;
  /** What was typed after the colon, lower-cased. */
  query: string;
}

const BEFORE = String.raw`(?:^|[\s(\[{"'“‘>*_~|])`;

/**
 * The `:shortcode` being typed just before the cursor, or null. The colon must
 * start a word and the query must hold a letter or digit, so times (10:30),
 * URLs (https://), `a:b`, `::` and table alignment rows (`|:---|`) stay untouched.
 */
export function findTrigger(line: string, ch: number, minChars = 2): Trigger | null {
  const m = new RegExp(`${BEFORE}(:[a-z0-9_+-]{${Math.max(1, minChars)},})$`, 'i').exec(line.slice(0, ch));
  if (!m || !/[a-z0-9]/i.test(m[1])) return null;
  return { start: ch - m[1].length, query: m[1].slice(1).toLowerCase() };
}

/**
 * A complete `:name:` ending at the cursor (the closing colon just typed), or
 * null. The caller checks that `name` is a real shortcode.
 */
export function findClosed(line: string, ch: number): Trigger | null {
  const m = new RegExp(`${BEFORE}(:[a-z0-9_+-]+:)$`, 'i').exec(line.slice(0, ch));
  if (!m) return null;
  return { start: ch - m[1].length, query: m[1].slice(1, -1).toLowerCase() };
}
