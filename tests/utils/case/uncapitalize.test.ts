import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { uncapitalize } from '../../../src/utils/index.ts';

describe('uncapitalize', () => {
  it('lowercases the first character of an uppercased string', () => {
    strictEqual(uncapitalize('Hello'), 'hello');
  });

  it('returns an already-lowercased string unchanged', () => {
    strictEqual(uncapitalize('hello'), 'hello');
  });

  it('only touches the first character, leaving the rest as-is', () => {
    strictEqual(uncapitalize('HELLO WORLD'), 'hELLO WORLD');
  });

  it('preserves trailing acronym casing', () => {
    strictEqual(uncapitalize('URL'), 'uRL');
  });

  it('returns an empty string unchanged', () => {
    strictEqual(uncapitalize(''), '');
  });

  it('handles single-character strings', () => {
    strictEqual(uncapitalize('A'), 'a');
    strictEqual(uncapitalize('a'), 'a');
  });

  it('leaves leading whitespace alone', () => {
    strictEqual(uncapitalize(' Hello'), ' Hello');
  });

  it('returns non-letter leading characters unchanged', () => {
    strictEqual(uncapitalize('1ABC'), '1ABC');
    strictEqual(uncapitalize('-ABC'), '-ABC');
  });

  it('preserves unicode beyond the first character', () => {
    strictEqual(uncapitalize('Café'), 'café');
  });
});
