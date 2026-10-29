import test from 'node:test';
import assert from 'node:assert/strict';

import { findClosed, findTrigger } from '../src/trigger.ts';

test('accepts a colon at the start of a word', () => {
  assert.deepEqual(findTrigger('hi :smi', 7), { start: 3, query: 'smi' });
  assert.deepEqual(findTrigger(':sm', 3), { start: 0, query: 'sm' });
  for (const pre of ['(', '"', '> ', '| ', '- ']) assert.equal(findTrigger(`${pre}:smi`, pre.length + 4)?.query, 'smi');
  assert.equal(findTrigger('x :+1', 5)?.query, '+1');
  assert.equal(findTrigger('x :-1', 5)?.query, '-1');
  assert.equal(findTrigger('x :SMI', 6)?.query, 'smi');
});

test('rejects times, urls, pairs, alignment rows and short queries', () => {
  for (const line of ['at 10:30', 'https://x', 'a:b', 'hi ::sm', '|:---|', '|:--', 'hi :s', 'hi :smile: ', 'C:\\x'])
    assert.equal(findTrigger(line, line.length), null, line);
});

test('the minimum length setting', () => {
  assert.equal(findTrigger('hi :d', 5, 1)?.query, 'd');
  assert.equal(findTrigger('hi :d', 5, 2), null);
  assert.equal(findTrigger('hi :sm', 6, 3), null);
});

test('only the text before the cursor counts', () => {
  assert.deepEqual(findTrigger('hi :smi tail', 7), { start: 3, query: 'smi' });
});

test('closing colon', () => {
  assert.deepEqual(findClosed('say :tada:', 10), { start: 4, query: 'tada' });
  assert.equal(findClosed('10:30:', 6), null);
  assert.equal(findClosed('C:\\x:', 5), null);
  assert.equal(findClosed('say :tada', 9), null);
});
