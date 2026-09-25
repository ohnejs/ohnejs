import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { MessageFormatError, MessageSyntaxError } from '../../../src/utils/i18n/message-errors.ts';

describe('MessageSyntaxError', () => {
  it('locates position 0 at line 1, column 1', () => {
    const err = new MessageSyntaxError('boom', 'hello', 0);
    strictEqual(err.line, 1);
    strictEqual(err.column, 1);
    strictEqual(err.snippet, 'hello\n^');
  });

  it('counts columns into the middle of a single-line template', () => {
    const err = new MessageSyntaxError('boom', 'hello world', 6);
    strictEqual(err.line, 1);
    strictEqual(err.column, 7);
    strictEqual(err.snippet, 'hello world\n      ^');
  });

  it('advances line on every \\n and resets column to 1', () => {
    const template = 'first\nsecond\nthird';
    const err = new MessageSyntaxError('boom', template, template.indexOf('third'));
    strictEqual(err.line, 3);
    strictEqual(err.column, 1);
    strictEqual(err.snippet, 'third\n^');
  });

  it('points at a column inside the third line', () => {
    const template = 'a\nbb\nccc';
    const err = new MessageSyntaxError('boom', template, template.indexOf('ccc') + 2);
    strictEqual(err.line, 3);
    strictEqual(err.column, 3);
    strictEqual(err.snippet, 'ccc\n  ^');
  });

  it('clamps positions past the end of the template', () => {
    const err = new MessageSyntaxError('boom', 'abc', 999);
    strictEqual(err.line, 1);
    strictEqual(err.column, 4);
    strictEqual(err.snippet, 'abc\n   ^');
  });

  it('clamps negative positions to the start', () => {
    const err = new MessageSyntaxError('boom', 'abc', -5);
    strictEqual(err.line, 1);
    strictEqual(err.column, 1);
    strictEqual(err.position, -5);
  });

  it('exposes position verbatim, name MessageSyntaxError, and is an Error', () => {
    const err = new MessageSyntaxError('boom', 'hello', 2);
    strictEqual(err.position, 2);
    strictEqual(err.name, 'MessageSyntaxError');
    strictEqual(err instanceof Error, true);
    strictEqual(err instanceof MessageSyntaxError, true);
  });

  it('embeds the line/column and snippet in the message', () => {
    const err = new MessageSyntaxError('unexpected }', 'hello\nbroken', 8);
    strictEqual(err.message.includes('unexpected }'), true);
    strictEqual(err.message.includes('(2:3)'), true);
    strictEqual(err.message.includes('broken'), true);
    strictEqual(err.message.includes('^'), true);
  });

  it('fences the source line in the message, keeping the snippet raw', () => {
    const err = new MessageSyntaxError('unexpected }', 'Hi `{name}` }', 12);
    strictEqual(err.message.split('\n')[1], '``Hi `{name}` }``');
    strictEqual(err.snippet, 'Hi `{name}` }\n            ^');
  });

  it('spells out a control character and keeps the caret under the offender', () => {
    const err = new MessageSyntaxError('boom', 'a\x1b }', 3);
    strictEqual(err.column, 4);
    strictEqual(err.snippet, 'a\\x1B }\n      ^');
    strictEqual(err.message, 'boom (1:4)\n`a\\x1B }`\n      ^');
  });

  it('leaves an empty source line empty in the message', () => {
    strictEqual(new MessageSyntaxError('boom', 'a\n', 2).message, 'boom (2:1)\n\n^');
  });

  it('handles \\r\\n by treating \\n as the line break (column counts include \\r)', () => {
    const template = 'a\r\nb';
    const err = new MessageSyntaxError('boom', template, 3);
    strictEqual(err.line, 2);
    strictEqual(err.column, 1);
  });

  it('handles an empty template at position 0', () => {
    const err = new MessageSyntaxError('boom', '', 0);
    strictEqual(err.line, 1);
    strictEqual(err.column, 1);
    strictEqual(err.snippet, '\n^');
  });
});

describe('MessageFormatError', () => {
  it('is an Error with the right name and message', () => {
    const err = new MessageFormatError('no Intl mapping for stem `unit/...`');
    strictEqual(err.name, 'MessageFormatError');
    strictEqual(err.message, 'no Intl mapping for stem `unit/...`');
    strictEqual(err instanceof Error, true);
    strictEqual(err instanceof MessageFormatError, true);
  });
});
