import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { UntypedQueryBuilder } from '../../../../src/ohne/query/untyped.ts';

import { useCollections } from '../../../../src/ohne/collections/use-collections.ts';
import { SQLiteDialect } from '../../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { buildDesiredSchema } from '../../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../../src/ohne/database/schema/sync.ts';
import { registerDatabase, registerDialect } from '../../../../src/ohne/database/use-database.ts';
import { field } from '../../../../src/ohne/fields/field.ts';
import { useFields } from '../../../../src/ohne/fields/use-fields.ts';
import { queryMetadata } from '../../../../src/ohne/query/metadata.ts';
import { queryUntyped } from '../../../../src/ohne/query/query.ts';
import { applyQuery } from '../../../../src/ohne/query/wire/apply.ts';
import { DEFAULT_QUERY_GUARDS } from '../../../../src/ohne/query/wire/guards.ts';
import { parseQueryParams } from '../../../../src/ohne/query/wire/parse.ts';
import { parseSearchParams } from '../../../../src/utils/index.ts';

useCollections().register('MPosts', {
  name: 'MPosts',
  collection: {
    fields: {
      title: field('text'),
      views: field('integer'),
      featured: field('boolean'),
      summary: field('text', { nullable: true }),
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

let seq = 0;
async function insert(
  title: string,
  views: number,
  featured: boolean,
  summary: string | null,
): Promise<void> {
  seq += 1;
  const uuid = `00000000-0000-7000-8000-${String(seq).padStart(12, '0')}`;
  await db.run(
    'INSERT INTO "MPosts" ("UUID","_updatedAt","title","views","featured","summary") VALUES (?,?,?,?,?,?)',
    [uuid, 0, title, views, featured ? 1 : 0, summary],
  );
}

await insert('Alpha', 100, true, 'first');
await insert('Beta', 50, false, null);
await insert('Gamma', 100, true, 'third');
await insert('Delta', 200, false, 'fourth');

const meta = queryMetadata('MPosts');

async function wire(url: string): Promise<unknown[]> {
  const parsed = parseQueryParams(parseSearchParams(url), meta, DEFAULT_QUERY_GUARDS);
  return applyQuery(queryUntyped('MPosts'), parsed).findMany();
}

async function fluent(builder: UntypedQueryBuilder): Promise<unknown[]> {
  return builder.findMany();
}

describe('the wire mirror returns the same rows as the fluent equivalent', () => {
  it('equalsTo', async () => {
    deepStrictEqual(
      await wire('where={featured:true}&order=[title]'),
      await fluent(queryUntyped('MPosts').where({ featured: true }).orderBy('title')),
    );
  });

  it('in', async () => {
    deepStrictEqual(
      await wire('where={views:{in:[50,200]}}&order=[title]'),
      await fluent(
        queryUntyped('MPosts')
          .where({ views: { in: [50, 200] } })
          .orderBy('title'),
      ),
    );
  });

  it('atLeast with a descending tiebreak', async () => {
    deepStrictEqual(
      await wire('where={views:{atLeast:100}}&order=[-views,title]'),
      await fluent(
        queryUntyped('MPosts')
          .where({ views: { atLeast: 100 } })
          .orderBy('views', 'desc')
          .orderBy('title'),
      ),
    );
  });

  it('contains, case-insensitive', async () => {
    deepStrictEqual(
      await wire('where={title:{contains:lph}}'),
      await fluent(queryUntyped('MPosts').where({ title: { contains: 'lph' } })),
    );
  });

  it('isNull', async () => {
    deepStrictEqual(
      await wire('where={summary:{isNull:true}}'),
      await fluent(queryUntyped('MPosts').where({ summary: { isNull: true } })),
    );
  });

  it('a negated comparison', async () => {
    deepStrictEqual(
      await wire('where={featured:{not:{equalsTo:true}}}&order=[title]'),
      await fluent(
        queryUntyped('MPosts')
          .where({ featured: { not: { equalsTo: true } } })
          .orderBy('title'),
      ),
    );
  });

  it('an OR group', async () => {
    deepStrictEqual(
      await wire('where={or:[{views:{atMost:50}},{views:{atLeast:200}}]}&order=[title]'),
      await fluent(
        queryUntyped('MPosts')
          .where({ or: [{ views: { atMost: 50 } }, { views: { atLeast: 200 } }] })
          .orderBy('title'),
      ),
    );
  });

  it('select narrows to exactly the named fields', async () => {
    deepStrictEqual(
      await wire('select=[title,views]&order=[title]'),
      await fluent(queryUntyped('MPosts').select('title', 'views').orderBy('title')),
    );
  });

  it('the row window', async () => {
    deepStrictEqual(
      await wire('order=[title]&limit=2&offset=1'),
      await fluent(queryUntyped('MPosts').orderBy('title').limit(2).offset(1)),
    );
  });
});
