import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { useCollections } from '../../../../src/ohne/collections/use-collections.ts';
import { field } from '../../../../src/ohne/fields/field.ts';
import { queryMetadata } from '../../../../src/ohne/query/metadata.ts';
import { uniqueRaceErrors } from '../../../../src/ohne/query/write/unique.ts';

useCollections().register('URUnique', {
  name: 'URUnique',
  collection: { fields: { slug: field('text', { unique: true }) } },
});
useCollections().register('URPlain', {
  name: 'URPlain',
  collection: { fields: { title: field('text') } },
});
useCollections().register('URComposite', {
  name: 'URComposite',
  collection: {
    fields: { email: field('text'), tenantId: field('text') },
    compositeIndexes: [{ fields: ['email', 'tenantId'], unique: true }],
  },
});

describe('uniqueRaceErrors', () => {
  it('names every top-level unique field', () => {
    deepStrictEqual(uniqueRaceErrors(queryMetadata('URUnique')), { slug: 'validation.notUnique' });
  });

  it('names every field a unique composite covers', () => {
    deepStrictEqual(uniqueRaceErrors(queryMetadata('URComposite')), {
      email: 'validation.notUnique',
      tenantId: 'validation.notUnique',
    });
  });

  it('falls back to a root error when no field is unique', () => {
    deepStrictEqual(uniqueRaceErrors(queryMetadata('URPlain')), { '': 'validation.notUnique' });
  });
});
