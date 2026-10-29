// "Frecent" emojis: how often and how recently each was used, with a 14-day half-life.
import { lookupChar } from './logic.ts';

export interface Entry {
  /** Decayed use count as of `t`. */
  n: number;
  /** Time of the last use, ms since the epoch. */
  t: number;
}

export type History = Record<string, Entry>;

const HALF_LIFE_MS = 14 * 24 * 3600 * 1000;

const decay = (age: number) => 0.5 ** (Math.max(0, age) / HALF_LIFE_MS);

/** The key for an emoji: its base character, whatever the tone or variation selector. */
export function keyOf(char: string): string {
  return lookupChar(char)?.char ?? char;
}

export function frecency(history: History, char: string, now: number): number {
  const e = history[keyOf(char)];
  return e ? e.n * decay(now - e.t) : 0;
}

/** Records a use and keeps the `max` best-scoring entries. */
export function record(history: History, char: string, now: number, max: number): History {
  const key = keyOf(char);
  const prev = history[key];
  const next: History = { ...history, [key]: { n: (prev ? prev.n * decay(now - prev.t) : 0) + 1, t: now } };
  const keys = Object.keys(next);
  if (keys.length <= max) return next;
  keys.sort((a, b) => frecency(next, b, now) - frecency(next, a, now));
  const kept: History = {};
  for (const k of keys.slice(0, max)) kept[k] = next[k];
  return kept;
}

/** The most used emojis first; ties go to the more recent one. */
export function top(history: History, count: number, now: number): string[] {
  return Object.keys(history)
    .sort((a, b) => frecency(history, b, now) - frecency(history, a, now) || history[b].t - history[a].t)
    .slice(0, Math.max(0, count));
}

/** Turns the 0.0.x list of recent characters into history, keeping its order. */
export function fromRecent(recent: string[], now: number): History {
  const out: History = {};
  recent.forEach((c, i) => {
    out[keyOf(c)] ??= { n: 1, t: now - i * 1000 };
  });
  return out;
}
