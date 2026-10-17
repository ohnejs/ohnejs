import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { scanTokens } from '../../../src/utils/highlight/scan-tokens.ts';

const comment = (match: RegExpExecArray) => (match[1] ? ('comment' as const) : undefined);

describe('scanTokens', () => {
  it('keeps only the classified matches, with their offsets', () => {
    deepStrictEqual(scanTokens('a # b\nc # d', /(#[^\n]*)|[^#]+/y, comment), [
      { kind: 'comment', start: 2, end: 5 },
      { kind: 'comment', start: 8, end: 11 },
    ]);
  });

  it('passes the whole code to the classifier', () => {
    const seen: string[] = [];
    scanTokens('ab', /./y, (_, code) => void seen.push(code));
    deepStrictEqual(seen, ['ab', 'ab']);
  });

  it('starts over from the beginning on every call', () => {
    const grammar = /(#[^\n]*)|[^#]+/y;
    scanTokens('x # y', grammar, comment);
    deepStrictEqual(scanTokens('# z', grammar, comment), [{ kind: 'comment', start: 0, end: 3 }]);
  });

  it('stops where no alternative matches, leaving the rest plain', () => {
    deepStrictEqual(scanTokens('#a!#b', /(#\w)/y, comment), [
      { kind: 'comment', start: 0, end: 2 },
    ]);
  });

  it('stops at an empty match instead of looping', () => {
    deepStrictEqual(scanTokens('#a b', /(#\w)|x*/y, comment), [
      { kind: 'comment', start: 0, end: 2 },
    ]);
  });

  it('returns no tokens for empty code', () => {
    deepStrictEqual(scanTokens('', /(.)/y, comment), []);
  });
});
