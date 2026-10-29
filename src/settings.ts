import { fromRecent, type History } from './history.ts';

export interface Settings {
  tone: number;
  history: History;
  frequentShown: number;
  suggest: boolean;
  minChars: number;
  suggestMax: number;
  closingColon: boolean;
  editorMenu: boolean;
  showUnsupported: boolean;
}

export const DEFAULTS: Settings = {
  tone: 0,
  history: {},
  frequentShown: 24,
  suggest: true,
  minChars: 2,
  suggestMax: 8,
  closingColon: true,
  editorMenu: true,
  showUnsupported: false,
};

const num = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);

/** Whatever `loadData()` returned, made safe: unknown keys dropped, wrong types repaired, sliders clamped. */
export function normalizeSettings(raw: unknown, now = Date.now()): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  let history: History = {};
  if (r.history && typeof r.history === 'object') {
    for (const [k, v] of Object.entries(r.history as Record<string, unknown>)) {
      const e = v as { n?: unknown; t?: unknown };
      if (typeof e?.n === 'number' && typeof e.t === 'number' && e.n > 0) history[k] = { n: e.n, t: e.t };
    }
  } else if (Array.isArray(r.recent)) {
    // 0.0.x kept a plain list of recent characters.
    history = fromRecent(r.recent.filter((c): c is string => typeof c === 'string'), now);
  }
  return {
    tone: num(r.tone, 0, 5, DEFAULTS.tone),
    history,
    frequentShown: num(r.frequentShown, 0, 48, DEFAULTS.frequentShown),
    suggest: bool(r.suggest, DEFAULTS.suggest),
    minChars: num(r.minChars, 1, 4, DEFAULTS.minChars),
    suggestMax: num(r.suggestMax, 3, 20, DEFAULTS.suggestMax),
    closingColon: bool(r.closingColon, DEFAULTS.closingColon),
    editorMenu: bool(r.editorMenu, DEFAULTS.editorMenu),
    showUnsupported: bool(r.showUnsupported, DEFAULTS.showUnsupported),
  };
}
