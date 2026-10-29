import test from 'node:test';
import assert from 'node:assert/strict';

import { mayComplete } from '../src/guard.ts';

const yes = (s: string) => assert.equal(mayComplete(s), true, s);
const no = (s: string) => assert.equal(mayComplete(s), false, s);

test('prose, headings, lists, quotes, tables', () => {
  yes('Hello ');
  yes('# Title ');
  yes('- item ');
  yes('> quote ');
  yes('| a | ');
  yes('$5 for ');
});

test('code: every line inside a fence, not just the fence line', () => {
  no('```js\nconst a = ');
  no('```\nline one\nline two ');
  no('~~~\nx ');
  no('- item\n  ```\n  code ');
  no('> ```\n> code ');
  yes('```\ncode\n```\nprose ');
  no('text `inline ');
  no('text ``double ` still ');
  yes('text `done` and ');
});

test('math', () => {
  no('formula $x ');
  no('$$\nx ');
  yes('$x$ and ');
});

test('links, urls and html', () => {
  no('see [[Note ');
  no('see [text](http://x ');
  no('see https://example.com/');
  no('<span class=');
  no('<!-- note ');
  no('<% tp.date ');
});

test('frontmatter: values yes, keys and fences no', () => {
  yes('---\nmood: ');
  yes('---\ntags:\n  - ');
  no('---\n');
  no('---\nmo');
  no('---\ntitle: x\n---\n```\ncode ');
  yes('---\ntitle: x\n---\nbody ');
});
