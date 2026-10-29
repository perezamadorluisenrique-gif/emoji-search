// Pure logic: no `obsidian` import, so tests/ can run it under plain Node.
import { ROWS, type Row } from './data.ts';

export interface Emoji {
  char: string;
  /** Lower-case, accent-folded label used for matching. */
  label: string;
  tags: string[];
  group: number;
  shortcodes: string[];
  skins: string[];
  version: number;
}

export const TONES = ['', '🏻', '🏼', '🏽', '🏾', '🏿'] as const;

/** Lower-case and strip accents, so "pinata" finds "piñata". */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** The emoji without variation selectors, so ❤ and ❤️ are the same key. */
export function bare(s: string): string {
  return s.replace(/️/g, '');
}

export function toEmoji(row: Row): Emoji {
  const [char, label, tags, group, shortcodes, skins, version] = row;
  return {
    char,
    label: fold(label),
    tags: tags ? tags.split(' ').map(fold) : [],
    group,
    shortcodes: shortcodes ? shortcodes.split(' ') : [],
    skins: skins ? skins.split(' ') : [],
    version,
  };
}

export const ALL: Emoji[] = ROWS.map(toEmoji);

const BY_CHAR = new Map<string, Emoji>();
const BY_SHORTCODE = new Map<string, Emoji>();
for (const e of ALL) {
  BY_CHAR.set(bare(e.char), e);
  for (const s of e.skins) BY_CHAR.set(bare(s), e);
  for (const s of e.shortcodes) if (!BY_SHORTCODE.has(s)) BY_SHORTCODE.set(s, e);
}

/** The emoji for a character, with or without a skin tone or the variation selector. */
export function lookupChar(char: string): Emoji | undefined {
  return BY_CHAR.get(bare(char));
}

/** The emoji whose shortcode is exactly `name` (no colons). */
export function lookupShortcode(name: string): Emoji | undefined {
  return BY_SHORTCODE.get(name.toLowerCase());
}

/** The emoji with the chosen skin tone (0 = default, 1-5 = light to dark) when it has one. */
export function withTone(e: Emoji, tone: number): string {
  return tone >= 1 && tone <= 5 && e.skins.length === 5 ? e.skins[tone - 1] : e.char;
}

function isSubsequence(q: string, s: string): boolean {
  let i = 0;
  for (let j = 0; j < s.length && i < q.length; j++) if (s[j] === q[i]) i++;
  return i === q.length;
}

const SUBSEQUENCE = 8;

/** Lower score is better; null means no match. */
function score(e: Emoji, q: string): number | null {
  if (e.shortcodes.includes(q) || e.label === q) return 0;
  if (e.shortcodes.some((s) => s.startsWith(q))) return 1;
  if (e.label.startsWith(q)) return 2;
  if (e.label.split(/[\s:,-]+/).some((w) => w.startsWith(q))) return 3;
  if (e.tags.includes(q)) return 4;
  if (e.tags.some((t) => t.startsWith(q))) return 5;
  if (e.shortcodes.some((s) => s.includes(q))) return 6;
  if (e.label.includes(q)) return 7;
  if (q.length >= 3 && (e.shortcodes.some((s) => isSubsequence(q, s)) || isSubsequence(q, e.label))) return SUBSEQUENCE;
  return null;
}

export interface SearchOptions {
  limit?: number;
  /** Frecency by base emoji char, see history.ts. */
  frecency?: (e: Emoji) => number;
  /** Emojis to leave out (the ones this device cannot draw). */
  hidden?: ReadonlySet<string>;
  list?: Emoji[];
}

/** Emojis matching every word of the query, best first. */
export function search(query: string, opts: SearchOptions = {}): Emoji[] {
  const { limit = 200, frecency, hidden, list = ALL } = opts;
  const visible = hidden && hidden.size ? list.filter((e) => !hidden.has(e.char)) : list;
  const q = query.trim();
  if (!q) return visible.slice(0, limit);
  // Pasting an emoji (or several) finds it by character.
  const pasted = [...q].some((c) => c.codePointAt(0)! > 0x2000) ? lookupChar(q.replace(/\s+/g, '')) : undefined;
  if (pasted) return [pasted];
  const parts = fold(q).replace(/:/g, ' ').split(/\s+/).filter(Boolean);
  if (parts.length === 0) return visible.slice(0, limit);
  const hits: { e: Emoji; s: number; f: number; i: number; fuzzy: boolean }[] = [];
  visible.forEach((e, i) => {
    let total = 0;
    let fuzzy = false;
    for (const p of parts) {
      const s = score(e, p);
      if (s === null) return;
      if (s === SUBSEQUENCE) fuzzy = true;
      total += s;
    }
    const f = frecency ? frecency(e) : 0;
    // Heavily used emojis climb one tier, but never past an exact match of another emoji.
    if (f >= 1.5 && total > 1) total -= 1;
    hits.push({ e, s: total, f, i, fuzzy });
  });
  // Letters scattered through a name are a last resort: only when nothing matches better.
  const exact = hits.filter((h) => !h.fuzzy);
  (exact.length ? exact : hits).sort(
    (a, b) =>
      a.s - b.s ||
      b.f - a.f ||
      (a.e.shortcodes[0]?.length ?? 99) - (b.e.shortcodes[0]?.length ?? 99) ||
      a.i - b.i,
  );
  return (exact.length ? exact : hits).slice(0, limit).map((h) => h.e);
}
