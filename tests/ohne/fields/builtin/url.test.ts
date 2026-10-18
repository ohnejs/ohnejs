import { rejects, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { useCollections } from '../../../../src/ohne/collections/use-collections.ts';
import { buildDesiredSchema } from '../../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../../src/ohne/database/schema/sync.ts';
import { registerDatabase, registerDialect } from '../../../../src/ohne/database/use-database.ts';
import { field } from '../../../../src/ohne/fields/field.ts';
import { useFields } from '../../../../src/ohne/fields/use-fields.ts';
import { queryUntyped } from '../../../../src/ohne/query/query.ts';
import { isValidationError } from '../../../../src/ohne/query/write/errors.ts';
import { connectTest, dialect } from '../../../_dialect.ts';

useCollections().register('Portals', {
  name: 'Portals',
  collection: {
    fields: {
      site: field('url', { unique: true }),
    },
  },
});

const db = await connectTest();
registerDialect(dialect);
registerDatabase(db);
await syncDatabase(db, dialect, {
  desired: buildDesiredSchema(useCollections(), useFields() as never),
});

const failsWith = (key: string) => (error: unknown) =>
  isValidationError(error) && error.errors.site === key;

describe('url writes', () => {
  it('folds the scheme and host and keeps the path', async () => {
    const portal = await queryUntyped('Portals').createOrThrow({
      site: ' HTTPS://Dalaran.Example:443/Violet/Citadel?Floor=2 ',
    });
    strictEqual(portal.site, 'https://dalaran.example/Violet/Citadel?Floor=2');
  });

  it('refuses another spelling of a stored address as taken', async () => {
    await queryUntyped('Portals').createOrThrow({ site: 'https://orgrimmar.example/' });
    await rejects(
      queryUntyped('Portals').createOrThrow({ site: 'https://ORGRIMMAR.example:443' }),
      failsWith('validation.notUnique'),
    );
  });

  it('refuses a final-sigma variant of a Greek host as taken', async () => {
    await queryUntyped('Portals').createOrThrow({ site: 'https://example.οδοσ' });
    await rejects(
      queryUntyped('Portals').createOrThrow({ site: 'https://EXAMPLE.ΟΔΟΣ/' }),
      failsWith('validation.notUnique'),
    );
  });

  it('refuses an address that is no absolute web address', async () => {
    for (const site of [
      'javascript:alert(1)',
      'mailto:a@x.example',
      '/path',
      'https://127.0.0.1',
      'https://orgrimmar.example：443',
      'https://orgr️immar.example',
    ]) {
      await rejects(
        queryUntyped('Portals').createOrThrow({ site }),
        failsWith('validation.invalidURL'),
      );
    }
  });
});
