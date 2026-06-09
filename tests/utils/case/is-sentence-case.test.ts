import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isSentenceCase } from '../../../src/utils/index.ts';

describe('isSentenceCase', () => {
  it('accepts a multi-word sentence-cased string', () => {
    strictEqual(isSentenceCase('First name'), true);
  });

  it('accepts a single capitalized word', () => {
    strictEqual(isSentenceCase('First'), true);
  });

  it('accepts a leading acronym', () => {
    strictEqual(isSentenceCase('HTML parser'), true);
  });

  it('accepts trailing acronyms', () => {
    strictEqual(isSentenceCase('Parse HTML'), true);
    strictEqual(isSentenceCase('Get API response'), true);
  });

  it('accepts a standalone acronym', () => {
    strictEqual(isSentenceCase('HTML'), true);
  });

  it('rejects title case (subsequent word capitalized but not an acronym)', () => {
    strictEqual(isSentenceCase('First Name'), false);
  });

  it('rejects a lowercase opening word', () => {
    strictEqual(isSentenceCase('first name'), false);
  });

  it('rejects camelCase', () => {
    strictEqual(isSentenceCase('firstName'), false);
  });

  it('rejects double spaces', () => {
    strictEqual(isSentenceCase('First  name'), false);
  });

  it('rejects leading or trailing whitespace', () => {
    strictEqual(isSentenceCase(' First name'), false);
    strictEqual(isSentenceCase('First name '), false);
  });

  it('rejects empty input', () => {
    strictEqual(isSentenceCase(''), false);
  });
});
