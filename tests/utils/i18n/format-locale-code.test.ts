import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { formatLocaleCode } from '../../../src/utils/i18n/format-locale-code.ts';

describe('formatLocaleCode', () => {
  it('uppercases a bare language code', () => {
    strictEqual(formatLocaleCode('en'), 'EN');
  });

  it('parenthesizes the region after the language', () => {
    strictEqual(formatLocaleCode('de-AT'), 'DE (AT)');
  });

  it('uppercases lowercase input', () => {
    strictEqual(formatLocaleCode('pt-br'), 'PT (BR)');
  });

  it('formats the empty string as itself', () => {
    strictEqual(formatLocaleCode(''), '');
  });
});
