import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { toTitleCase } from '../../../src/utils/index.ts';

describe('toTitleCase', () => {
  it('converts camelCase', () => {
    strictEqual(toTitleCase('firstName'), 'First Name');
  });

  it('converts PascalCase', () => {
    strictEqual(toTitleCase('BlogPost'), 'Blog Post');
  });

  it('converts kebab-case', () => {
    strictEqual(toTitleCase('first-name'), 'First Name');
  });

  it('converts snake_case', () => {
    strictEqual(toTitleCase('first_name'), 'First Name');
  });

  it('handles a single lowercase word', () => {
    strictEqual(toTitleCase('email'), 'Email');
  });

  it('handles a single already-capitalized word', () => {
    strictEqual(toTitleCase('Email'), 'Email');
  });

  it('preserves embedded acronyms', () => {
    strictEqual(toTitleCase('HTMLParser'), 'HTML Parser');
    strictEqual(toTitleCase('parseHTML'), 'Parse HTML');
    strictEqual(toTitleCase('getAPIResponse'), 'Get API Response');
  });

  it('preserves a standalone acronym', () => {
    strictEqual(toTitleCase('HTML'), 'HTML');
  });

  it('preserves acronyms across snake_case separators', () => {
    strictEqual(toTitleCase('HTML_parser'), 'HTML Parser');
  });

  it('keeps digits in their word', () => {
    strictEqual(toTitleCase('v2Release'), 'V2 Release');
  });

  it('returns an empty string for empty input', () => {
    strictEqual(toTitleCase(''), '');
  });

  it('returns an empty string for separator-only input', () => {
    strictEqual(toTitleCase('---'), '');
  });
});
