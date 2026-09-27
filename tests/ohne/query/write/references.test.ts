import { deepStrictEqual, rejects } from 'node:assert';
import { describe, it } from 'node:test';

import type { RelationRef } from '../../../../src/ohne/query/pipeline/run-record.ts';
import type { QueryScope } from '../../../../src/ohne/query/wire/apply.ts';

import { useCollections } from '../../../../src/ohne/collections/use-collections.ts';
import { SQLiteDialect } from '../../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { buildDesiredSchema } from '../../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../../src/ohne/database/schema/sync.ts';
import { registerDatabase, registerDialect } from '../../../../src/ohne/database/use-database.ts';
import { field } from '../../../../src/ohne/fields/field.ts';
import { useFields } from '../../../../src/ohne/fields/use-fields.ts';
import { queryUntyped } from '../../../../src/ohne/query/query.ts';
import { checkReferences, linkReachable } from '../../../../src/ohne/query/write/references.ts';

useCollections().register('RFTargets', {
  name: 'RFTargets',
  collection: { fields: { owner: field('text') } },
});

const dialect = new SQLiteDialect();
const db = await dialect.connect(':memory:');
registerDialect(dialect);
registerDatabase(db);
await syncDatabase(db, dialect, {
  desired: buildDesiredSchema(useCollections(), useFields() as never),
});

const mine = (await queryUntyped('RFTargets').createOrThrow({ owner: 'me' })).UUID as string;
const theirs = (await queryUntyped('RFTargets').createOrThrow({ owner: 'them' })).UUID as string;
const missing = '01900000-0000-7000-8000-000000000000';

function ref(path: string, uuid: string, provided = true): RelationRef {
  return { path, target: 'RFTargets', uuid, provided };
}

function reach(scope: QueryScope | false) {
  return { resolve: async () => scope, locale: 'en' };
}

describe('checkReferences', () => {
  it('checks existence alone without a reach', async () => {
    const refs = [ref('a', mine), ref('b', theirs), ref('c', missing)];
    deepStrictEqual(await checkReferences(db, dialect, refs), {
      c: 'validation.invalidReference',
    });
  });

  it('refuses a provided link a `false` reach hides, and passes an unprovided one', async () => {
    const refs = [ref('a', mine), ref('b', theirs, false)];
    deepStrictEqual(await checkReferences(db, dialect, refs, reach(false)), {
      a: 'validation.invalidReference',
    });
  });

  it('admits the provided links a scope `where` reaches', async () => {
    const refs = [ref('a', mine), ref('b', theirs)];
    deepStrictEqual(await checkReferences(db, dialect, refs, reach({ where: { owner: 'me' } })), {
      b: 'validation.invalidReference',
    });
  });

  it('admits every existing link under a scope without `where`', async () => {
    const refs = [ref('a', mine), ref('b', theirs), ref('c', missing)];
    deepStrictEqual(await checkReferences(db, dialect, refs, reach({ select: ['owner'] })), {
      c: 'validation.invalidReference',
    });
  });

  it('answers a hidden link exactly as a missing one', async () => {
    const scope = reach({ where: { owner: 'me' } });
    deepStrictEqual(
      await checkReferences(db, dialect, [ref('a', theirs)], scope),
      await checkReferences(db, dialect, [ref('a', missing)], scope),
    );
  });

  it('resolves the reach for a missing link too, so a throwing reach answers both alike', async () => {
    const forbidden = {
      resolve: async (): Promise<false> => {
        throw new Error('forbidden');
      },
      locale: 'en',
    };
    await rejects(checkReferences(db, dialect, [ref('a', theirs)], forbidden), /forbidden/);
    await rejects(checkReferences(db, dialect, [ref('a', missing)], forbidden), /forbidden/);
  });
});

describe('linkReachable', () => {
  it('reaches every `UUID` without a reach', async () => {
    deepStrictEqual(await linkReachable()('RFTargets', [mine, missing]), new Set([mine, missing]));
  });

  it('narrows to what the reach admits', async () => {
    const reachable = linkReachable(reach({ where: { owner: 'me' } }));
    deepStrictEqual(await reachable('RFTargets', [mine, theirs]), new Set([mine]));
  });
});
