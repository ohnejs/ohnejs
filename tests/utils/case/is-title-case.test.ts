import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isTitleCase } from '../../../src/utils/index.ts';

describe('isTitleCase', () => {
  it('accepts a multi-word title-cased string', () => {
    strictEqual(isTitleCase('First Name'), true);
  });

  it('accepts a single capitalized word', () => {
    strictEqual(isTitleCase('First'), true);
  });

  it('accepts embedded acronyms', () => {
    strictEqual(isTitleCase('Parse HTML'), true);
    strictEqual(isTitleCase('Get API Response'), true);
  });

  it('accepts a standalone acronym', () => {
    strictEqual(isTitleCase('HTML'), true);
  });

  it('accepts digit-only words', () => {
    strictEqual(isTitleCase('V 2 Release'), true);
  });

  it('rejects sentence case', () => {
    strictEqual(isTitleCase('First name'), false);
  });

  it('rejects camelCase', () => {
    strictEqual(isTitleCase('firstName'), false);
  });

  it('rejects a leading lowercase word', () => {
    strictEqual(isTitleCase('first Name'), false);
  });

  it('rejects double spaces', () => {
    strictEqual(isTitleCase('First  Name'), false);
  });

  it('rejects leading or trailing whitespace', () => {
    strictEqual(isTitleCase(' First Name'), false);
    strictEqual(isTitleCase('First Name '), false);
  });

  it('rejects empty input', () => {
    strictEqual(isTitleCase(''), false);
  });
});
