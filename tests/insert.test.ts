import test from 'node:test';
import assert from 'node:assert/strict';

import { planInsert } from '../src/insert.ts';

const caret = (line: number, ch: number) => ({ from: { line, ch }, to: { line, ch } });

test('one caret', () => {
  const p = planInsert([caret(0, 3)], '🎉');
  assert.deepEqual(p.changes, [{ from: { line: 0, ch: 3 }, to: { line: 0, ch: 3 }, text: '🎉' }]);
  assert.deepEqual(p.selections, [caret(0, 5)]);
});

test('a selection is replaced', () => {
  const p = planInsert([{ from: { line: 0, ch: 1 }, to: { line: 0, ch: 4 } }], '👍');
  assert.equal(p.changes.length, 1);
  assert.deepEqual(p.selections, [caret(0, 3)]);
});

test('three carets on one line shift the later ones', () => {
  const p = planInsert([caret(0, 1), caret(0, 3), caret(0, 5)], '👍');
  assert.deepEqual(p.selections, [caret(0, 3), caret(0, 7), caret(0, 11)]);
});

test('carets on different lines stay put', () => {
  const p = planInsert([caret(0, 1), caret(2, 4)], 'x');
  assert.deepEqual(p.selections, [caret(0, 2), caret(2, 5)]);
});

test('reverse order and duplicate carets', () => {
  const p = planInsert([caret(0, 5), caret(0, 1), caret(0, 1)], 'x');
  assert.equal(p.changes.length, 2);
  assert.deepEqual(p.selections, [caret(0, 2), caret(0, 7)]);
});

test('a selection spanning lines moves the following line up', () => {
  const p = planInsert([{ from: { line: 0, ch: 2 }, to: { line: 1, ch: 3 } }, caret(1, 5)], 'x');
  assert.deepEqual(p.selections, [caret(0, 3), caret(0, 6)]);
});

test('a ZWJ sequence lands the caret after the whole sequence', () => {
  const seq = '👩‍💻';
  assert.deepEqual(planInsert([caret(0, 0)], seq).selections, [caret(0, seq.length)]);
});
