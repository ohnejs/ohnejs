import { deepStrictEqual, strictEqual } from 'node:assert';
import { afterEach, describe, it } from 'node:test';

import type { ConditionNode } from '../../../../src/utils/index.ts';

import { useCollections } from '../../../../src/ohne/collections/use-collections.ts';
import { SQLiteDialect } from '../../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { buildDesiredSchema } from '../../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../../src/ohne/database/schema/sync.ts';
import { registerDatabase, registerDialect } from '../../../../src/ohne/database/use-database.ts';
import { field } from '../../../../src/ohne/fields/field.ts';
import { useFields } from '../../../../src/ohne/fields/use-fields.ts';
import { hook } from '../../../../src/ohne/hooks/hook.ts';
import { useHooks } from '../../../../src/ohne/hooks/use-hooks.ts';
import { queryUntyped } from '../../../../src/ohne/query/query.ts';
import { isNull } from '../../../../src/utils/index.ts';

useCollections().register('RPosts', {
  name: 'RPosts',
  collection: {
    fields: {
      title: field('text'),
      views: field('integer'),
      featured: field('boolean'),
    },
  },
});

const dialect = new SQLiteDialect();
const db = await dialect.connect(':memory:');
registerDialect(dialect);
registerDatabase(db);
await syncDatabase(db, dialect, {
  desired: buildDesiredSchema(useCollections(), useFields() as never),
});

const ID = {
  alpha: '00000000-0000-7000-8000-0000000000a1',
  beta: '00000000-0000-7000-8000-0000000000a2',
  gamma: '00000000-0000-7000-8000-0000000000a3',
};

async function insert(
  uuid: string,
  title: string,
  views: number,
  featured: boolean,
): Promise<void> {
  await db.run(
    'INSERT INTO "RPosts" ("UUID","_updatedAt","title","views","featured") VALUES (?,?,?,?,?)',
    [uuid, 0, title, views, featured ? 1 : 0],
  );
}

await insert(ID.alpha, 'Alpha', 100, true);
await insert(ID.beta, 'Beta', 50, false);
await insert(ID.gamma, 'Gamma', 100, true);

afterEach(() => useHooks().clear());

describe('query:filter', () => {
  it('AND-injects a scope that reaches both the row read and the count', async () => {
    hook('query:filter', (ir) => {
      const scope: ConditionNode = {
        kind: 'compare',
        path: ['featured'],
        op: 'equalsTo',
        value: true,
        negated: false,
      };
      const condition: ConditionNode = isNull(ir.condition)
        ? scope
        : { kind: 'and', nodes: [ir.condition, scope] };
      return { ...ir, condition };
    });

    const titles = (await queryUntyped('RPosts').orderBy('title').findMany()).map(
      (row) => row.title,
    );
    deepStrictEqual(titles, ['Alpha', 'Gamma']);
    strictEqual(await queryUntyped('RPosts').count(), 2);
  });
});
