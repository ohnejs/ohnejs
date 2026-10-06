import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { DashboardMeta } from '../../../src/dashboard/runtime/meta-types.ts';

import { labelKey, labelScope } from '../../../src/dashboard/fields/_label-keys.ts';

const meta = {
  defaultLocale: 'en',
  locales: ['en', 'bs'],
  collections: [
    { name: 'Pages', translatable: true },
    { name: 'Authors', translatable: false },
  ],
} as unknown as DashboardMeta;

const UUID = '01a1120e-af7b-7628-a1d2-05223c10ef9d';

describe('labelScope', () => {
  it('scopes a translatable target to a locale other than the default', () => {
    strictEqual(labelScope(meta, 'Pages', 'bs'), 'bs');
  });

  it('shares the default scope between the default locale named and omitted', () => {
    strictEqual(labelScope(meta, 'Pages', 'en'), undefined);
    strictEqual(labelScope(meta, 'Pages', undefined), undefined);
  });

  it('shares one scope across locales for an untranslated or unknown target', () => {
    strictEqual(labelScope(meta, 'Authors', 'bs'), undefined);
    strictEqual(labelScope(meta, 'Ghosts', 'bs'), undefined);
  });
});

describe('labelKey', () => {
  it('keeps a translated label apart from the default one', () => {
    strictEqual(labelKey('Pages', UUID, undefined), `Pages:${UUID}`);
    strictEqual(labelKey('Pages', UUID, 'bs'), `Pages@bs:${UUID}`);
  });
});
