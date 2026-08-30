import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { parseTemplate } from '../../../src/utils/index.ts';

describe('parseTemplate', () => {
  it('parses fields and literals in order', () => {
    deepStrictEqual(parseTemplate('{lastName}, {firstName}'), [
      { kind: 'field', name: 'lastName' },
      { kind: 'literal', text: ', ' },
      { kind: 'field', name: 'firstName' },
    ]);
  });

  it('keeps leading and trailing literals', () => {
    deepStrictEqual(parseTemplate('#{id}!'), [
      { kind: 'literal', text: '#' },
      { kind: 'field', name: 'id' },
      { kind: 'literal', text: '!' },
    ]);
  });

  it('never emits an empty literal between adjacent fields', () => {
    deepStrictEqual(parseTemplate('{a}{b}'), [
      { kind: 'field', name: 'a' },
      { kind: 'field', name: 'b' },
    ]);
  });

  it('trims token names', () => {
    deepStrictEqual(parseTemplate('{ title }'), [{ kind: 'field', name: 'title' }]);
  });

  it('parses a template without tokens into one literal', () => {
    deepStrictEqual(parseTemplate('plain'), [{ kind: 'literal', text: 'plain' }]);
  });

  it('returns undefined for an unclosed token', () => {
    strictEqual(parseTemplate('{oops'), undefined);
    strictEqual(parseTemplate('{a}, {b'), undefined);
  });

  it('returns undefined for a stray closing brace', () => {
    strictEqual(parseTemplate('a}b'), undefined);
    strictEqual(parseTemplate('{a}}'), undefined);
  });

  it('returns undefined for an empty or nested token', () => {
    strictEqual(parseTemplate('{}'), undefined);
    strictEqual(parseTemplate('{  }'), undefined);
    strictEqual(parseTemplate('{a{b}}'), undefined);
  });
});
