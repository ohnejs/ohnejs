import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { resolveCatalog } from '../../../src/utils/i18n/resolve-catalog.ts';

const CATALOGS = {
  en: { 'nav.go': 'Go', 'nav.back': 'Back', 'field.required': 'Required' },
  de: { 'nav.go': 'Los' },
  'de-AT': { 'nav.back': 'Zruck' },
};

describe('resolveCatalog', () => {
  it('takes each key from the most specific language, then the default', () => {
    deepStrictEqual(resolveCatalog(CATALOGS, 'nav', 'de-AT', 'en'), {
      'nav.go': { template: 'Los', language: 'de' },
      'nav.back': { template: 'Zruck', language: 'de-AT' },
    });
  });

  it('keeps only the group asked for', () => {
    deepStrictEqual(resolveCatalog(CATALOGS, 'field', 'de', 'en'), {
      'field.required': { template: 'Required', language: 'en' },
    });
  });

  it('answers an empty catalog for a group no language defines', () => {
    deepStrictEqual(resolveCatalog(CATALOGS, 'shop', 'en', 'en'), {});
  });
});
