import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULTS, normalizeSettings } from '../src/settings.ts';

test('garbage gives the defaults', () => {
  for (const raw of [null, undefined, 5, 'x', [], {}]) assert.deepEqual(normalizeSettings(raw), DEFAULTS);
});

test('sliders clamp, types repair, unknown keys drop', () => {
  const s = normalizeSettings({ tone: 99, minChars: 0, suggestMax: 'x', suggest: 'yes', nope: 1, frequentShown: 7.6 });
  assert.equal(s.tone, 5);
  assert.equal(s.minChars, 1);
  assert.equal(s.suggestMax, DEFAULTS.suggestMax);
  assert.equal(s.suggest, true);
  assert.equal(s.frequentShown, 8);
  assert.ok(!('nope' in s));
});

test('the old recent list becomes history, in order', () => {
  const s = normalizeSettings({ recent: ['🎉', '😅', 3] }, 5000);
  assert.deepEqual(Object.keys(s.history).sort(), ['🎉', '😅']);
  assert.ok(s.history['🎉'].t > s.history['😅'].t);
});

test('bad history entries are dropped', () => {
  const s = normalizeSettings({ history: { '🎉': { n: 2, t: 1 }, x: { n: 'a', t: 1 }, y: null } });
  assert.deepEqual(Object.keys(s.history), ['🎉']);
});
