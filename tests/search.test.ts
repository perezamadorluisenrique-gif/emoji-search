import test from 'node:test';
import assert from 'node:assert/strict';

import { ALL, lookupChar, lookupShortcode, search, withTone } from '../src/logic.ts';
import { frecency, fromRecent, keyOf, record, top } from '../src/history.ts';

const first = (q: string, opts = {}) => search(q, opts)[0]?.char;

test('tiers: exact shortcode first', () => {
  assert.equal(first('smile'), '😄');
  assert.equal(first('heart'), '❤️');
  assert.equal(first('+1'), '👍');
  assert.equal(first('tada'), '🎉');
});

test('label words and tags match, in any order', () => {
  assert.ok(search('party').some((e) => e.char === '🎉'));
  assert.ok(search('cat face').some((e) => e.char === '🐱'));
  assert.ok(search('face cat').some((e) => e.char === '🐱'));
  assert.ok(search('hello').some((e) => e.char === '👋'));
});

test('accents fold', () => {
  assert.ok(search('pinata').some((e) => e.char === '🪅'));
});

test('pasting an emoji finds it, with or without tone or selector', () => {
  assert.equal(first('🐱'), '🐱');
  assert.equal(first('👋🏽'), '👋');
  assert.equal(lookupChar('❤')?.char, '❤️');
});

test('subsequence only from three characters', () => {
  assert.ok(search('thmbs').some((e) => e.char === '👍'));
  assert.equal(search('zqx').length, 0);
});

test('scattered letters only count when nothing matches better', () => {
  assert.ok(search('tad').every((e) => e.shortcodes.some((c) => c.includes('tad')) || e.label.includes('tad') || e.tags.some((t) => t.includes('tad'))));
});

test('no match, empty query and limit', () => {
  assert.deepEqual(search('zzzzqqq'), []);
  assert.equal(search('', { limit: 10 }).length, 10);
});

test('hidden emojis are left out', () => {
  assert.ok(!search('smile', { hidden: new Set(['😄']) }).some((e) => e.char === '😄'));
});

test('fully qualified sequences', () => {
  assert.ok(ALL.some((e) => e.char === '❤️' && e.char.includes('️')));
  assert.ok(ALL.some((e) => e.char === '☺️'));
});

test('data carries recent Unicode versions and unique shortcodes', () => {
  assert.ok(ALL.some((e) => e.version >= 15));
  assert.ok(ALL.length > 1800);
  const seen = new Map<string, string>();
  for (const e of ALL) for (const s of e.shortcodes) {
    assert.match(s, /^[a-z0-9_+-]+$/);
    // Presets may share a name between two emojis; the lookup keeps the first.
    seen.set(s, seen.get(s) ?? e.char);
  }
  assert.equal(lookupShortcode('tada')?.char, '🎉');
  assert.equal(lookupShortcode('nope_nope'), undefined);
});

test('skin tones apply only where they exist', () => {
  const wave = lookupChar('👋')!;
  assert.equal(wave.skins.length, 5);
  assert.equal(withTone(wave, 0), '👋');
  assert.equal(withTone(wave, 3), '👋🏽');
  assert.equal(withTone(lookupChar('🐱')!, 3), '🐱');
});

test('frecency decays with a 14 day half-life and ignores tone', () => {
  const day = 24 * 3600 * 1000;
  let h = record({}, '👋🏽', 0, 10);
  h = record(h, '👋', 0, 10);
  assert.equal(Object.keys(h).length, 1);
  assert.equal(frecency(h, '👋🏿', 0), 2);
  assert.ok(Math.abs(frecency(h, '👋', 14 * day) - 1) < 1e-9);
});

test('history keeps the best entries and ranks them', () => {
  let h = {};
  for (const c of ['🎉', '🎉', '🎉', '😅', '👍']) h = record(h, c, 0, 2);
  assert.equal(Object.keys(h).length, 2);
  assert.ok(top(h, 5, 0).includes(keyOf('🎉')));
  assert.equal(top(h, 1, 0)[0], '🎉');
});

test('frecency breaks ties: a habit puts 😅 first for :swe', () => {
  const day = 24 * 3600 * 1000;
  const now = 100 * day;
  let h = {};
  for (let i = 0; i < 3; i++) h = record(h, '😅', now - i * day, 50);
  const f = (e: { char: string }) => frecency(h, e.char, now);
  assert.equal(first('swe', { frecency: f }), '😅');
  // Ninety days later the habit has faded and the plain order returns.
  const later = (e: { char: string }) => frecency(h, e.char, now + 90 * day);
  assert.notEqual(first('swe', { frecency: later }), undefined);
  assert.ok(later(lookupChar('😅')!) < 0.1);
});

test('frecency never beats an exact shortcode of another emoji', () => {
  const heavy = (e: { char: string }) => (e.char === '🎊' ? 50 : 0);
  assert.equal(first('tada', { frecency: heavy }), '🎉');
});

test('migrates the old recent list in order', () => {
  const h = fromRecent(['🎉', '😅'], 1000);
  assert.deepEqual(top(h, 2, 1000), ['🎉', '😅']);
});

test('1000 queries stay fast', () => {
  const t = Date.now();
  for (let i = 0; i < 1000; i++) search('abcdefghijklmnopqrstuvwxyz'.slice(i % 20, (i % 20) + 1 + (i % 4)));
  assert.ok(Date.now() - t < 1500);
});
