import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import type { FieldInstance } from '../../../../src/ohne/fields/field.ts';
import type { FieldTypeName } from '../../../../src/ohne/fields/known-fields.ts';
import type { UntypedQueryBuilder } from '../../../../src/ohne/query/untyped.ts';

import { useBlocks } from '../../../../src/ohne/blocks/use-blocks.ts';
import { useCollections } from '../../../../src/ohne/collections/use-collections.ts';
import { SQLiteDialect } from '../../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { buildDesiredSchema } from '../../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../../src/ohne/database/schema/sync.ts';
import { registerDatabase, registerDialect } from '../../../../src/ohne/database/use-database.ts';
import { defineField } from '../../../../src/ohne/fields/define-field.ts';
import { field } from '../../../../src/ohne/fields/field.ts';
import { useFields } from '../../../../src/ohne/fields/use-fields.ts';
import { HTTPError } from '../../../../src/ohne/http/http-error.ts';
import { useLayers } from '../../../../src/ohne/layers/use-layers.ts';
import { queryMetadata } from '../../../../src/ohne/query/metadata.ts';
import { queryUntyped } from '../../../../src/ohne/query/query.ts';
import { lowerField } from '../../../../src/ohne/query/where-field.ts';
import { applyQuery } from '../../../../src/ohne/query/wire/apply.ts';
import { DEFAULT_QUERY_GUARDS } from '../../../../src/ohne/query/wire/guards.ts';
import { parseQueryParams } from '../../../../src/ohne/query/wire/parse.ts';
import {
  parseSearchParams,
  stringifySearchParams,
  type SearchParamValue,
} from '../../../../src/utils/index.ts';

useLayers().add({
  path: '/mirror',
  input: { collections: { locales: ['en', 'de'], defaultLocale: 'en' } },
});

useCollections().register('MAuthors', {
  name: 'MAuthors',
  collection: {
    fields: { name: field('text'), boss: field('record', { collection: 'MAuthors' }) },
  },
});

useCollections().register('MPosts', {
  name: 'MPosts',
  collection: {
    fields: {
      title: field('text'),
      views: field('integer'),
      featured: field('boolean'),
      summary: field('text', { nullable: true }),
      author: field('record', { collection: 'MAuthors' }),
    },
  },
});

useCollections().register('MNotes', {
  name: 'MNotes',
  collection: {
    fields: {
      label: field('text', { translatable: true }),
      pinned: field('boolean'),
    },
  },
});

useBlocks().register('MHero', { name: 'MHero', block: { fields: { title: field('text') } } });
useBlocks().register('MQuote', { name: 'MQuote', block: { fields: { words: field('text') } } });
useCollections().register('MPages', {
  name: 'MPages',
  collection: {
    fields: {
      title: field('text'),
      content: field('blocks', { allow: ['MHero', 'MQuote'] }),
    },
  },
});

useFields().register('MTagList', {
  name: 'MTagList' as FieldTypeName,
  fieldType: defineField({ columnType: 'json', jsonList: true, forceNullable: true }),
});
useCollections().register('MTagged', {
  name: 'MTagged',
  collection: {
    fields: {
      title: field('text'),
      secret: field('text', { readable: false }),
      tags: { type: 'MTagList', options: {} } as unknown as FieldInstance,
    },
  },
});

const dialect = new SQLiteDialect();
const db = await dialect.connect(':memory:');
registerDialect(dialect);
registerDatabase(db);
await syncDatabase(db, dialect, {
  desired: buildDesiredSchema(useCollections(), useFields() as never, useBlocks()),
});

const arthas = '00000000-0000-7000-8000-00000000000a';
const anduin = '00000000-0000-7000-8000-00000000000b';
await db.run('INSERT INTO "MAuthors" ("UUID","_updatedAt","name","boss") VALUES (?,?,?,?)', [
  arthas,
  0,
  'Arthas',
  null,
]);
await db.run('INSERT INTO "MAuthors" ("UUID","_updatedAt","name","boss") VALUES (?,?,?,?)', [
  anduin,
  0,
  'Anduin',
  arthas,
]);

let seq = 0;
async function insert(
  title: string,
  views: number,
  featured: boolean,
  summary: string | null,
  author: string | null = null,
): Promise<void> {
  seq += 1;
  const uuid = `00000000-0000-7000-8000-${String(seq).padStart(12, '0')}`;
  await db.run(
    'INSERT INTO "MPosts" ("UUID","_updatedAt","title","views","featured","summary","author") VALUES (?,?,?,?,?,?,?)',
    [uuid, 0, title, views, featured ? 1 : 0, summary, author],
  );
}

await insert('Alpha', 100, true, 'first', anduin);
await insert('Beta', 50, false, null, arthas);
await insert('Gamma', 100, true, 'third', anduin);
await insert('Delta', 200, false, 'fourth');

await queryUntyped('MPages').createOrThrow({
  title: 'One',
  content: [
    { block: 'MHero', fields: { title: 'Launch' } },
    { block: 'MQuote', fields: { words: 'Sage' } },
  ],
});
await queryUntyped('MPages').createOrThrow({
  title: 'Two',
  content: [{ block: 'MHero', fields: { title: 'Docked' } }],
});
await queryUntyped('MPages').createOrThrow({
  title: 'Three',
  content: [{ block: 'MQuote', fields: { words: 'Calm' } }],
});
await queryUntyped('MPages').createOrThrow({ title: 'Four' });

let taggedSeq = 0;
async function insertTagged(
  title: string,
  secret: string,
  tags: readonly string[] | null,
): Promise<void> {
  taggedSeq += 1;
  const uuid = `00000000-0000-7000-9000-${String(taggedSeq).padStart(12, '0')}`;
  await db.run(
    'INSERT INTO "MTagged" ("UUID","_updatedAt","title","secret","tags") VALUES (?,?,?,?,?)',
    [uuid, 0, title, secret, tags === null ? null : JSON.stringify(tags)],
  );
}

await insertTagged('Ash', 'shh', ['news', 'tech']);
await insertTagged('Birch', 'shh', ['news']);
await insertTagged('Cedar', 'plain', ['tech', 'life']);
await insertTagged('Dune', 'shh', null);

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

describe('the populate wire forms mirror their fluent equivalents', () => {
  it('a bare name', async () => {
    deepStrictEqual(
      await wire('populate=[author]&order=[title]'),
      await fluent(queryUntyped('MPosts').populate('author').orderBy('title')),
    );
  });

  it('a subselecting spec against the callback form', async () => {
    deepStrictEqual(
      await wire('populate=[{author:{select:[name]}}]&order=[title]'),
      await fluent(
        queryUntyped('MPosts')
          .populate('author', (a) => a.select('name'))
          .orderBy('title'),
      ),
    );
  });

  it('a deep spec against the nested callback form', async () => {
    deepStrictEqual(
      await wire(
        'populate=[{author:{select:[name,boss],populate:[{boss:{select:[name]}}]}}]&order=[title]',
      ),
      await fluent(
        queryUntyped('MPosts')
          .populate('author', (a) =>
            a.select('name', 'boss').populate('boss', (b) => b.select('name')),
          )
          .orderBy('title'),
      ),
    );
  });

  it('a lone-string select and populate inside a spec replay cleanly', async () => {
    deepStrictEqual(
      await wire('populate=[{author:{select:name}}]&order=[title]'),
      await fluent(
        queryUntyped('MPosts')
          .populate('author', (a) => a.select('name'))
          .orderBy('title'),
      ),
    );
    deepStrictEqual(
      await wire('populate=[{author:{populate:boss}}]&order=[title]'),
      await fluent(
        queryUntyped('MPosts')
          .populate('author', (a) => a.populate('boss'))
          .orderBy('title'),
      ),
    );
  });

  it('a spec survives the stringify round-trip byte-exactly', async () => {
    const populate: SearchParamValue = [
      { author: { select: ['name', 'boss'], populate: [{ boss: { select: ['name'] } }] } },
    ];
    const url = stringifySearchParams({ populate, order: ['title'] });
    deepStrictEqual(parseSearchParams(url).populate, populate);
    deepStrictEqual(
      await wire(url),
      await wire(
        'populate=[{author:{select:[name,boss],populate:[{boss:{select:[name]}}]}}]&order=[title]',
      ),
    );
  });
});

describe('the locale param mirrors the fluent locale', () => {
  const notesMeta = queryMetadata('MNotes');

  async function wireNotes(url: string): Promise<unknown[]> {
    const parsed = parseQueryParams(parseSearchParams(url), notesMeta, DEFAULT_QUERY_GUARDS);
    return applyQuery(queryUntyped('MNotes'), parsed).findMany();
  }

  it('reads the same rows per locale, missing translations included', async () => {
    const created = await queryUntyped('MNotes').createOrThrow({ label: 'Note', pinned: true });
    await queryUntyped('MNotes')
      .locale('de')
      .where({ UUID: created.UUID as string })
      .updateOrThrow({ label: 'Notiz' });
    await queryUntyped('MNotes').createOrThrow({ label: 'Only English', pinned: false });

    deepStrictEqual(
      await wireNotes('locale=de&where={label:{contains:Notiz}}'),
      await fluent(
        queryUntyped('MNotes')
          .locale('de')
          .where({ label: { contains: 'Notiz' } }),
      ),
    );
    deepStrictEqual(
      await wireNotes('locale=de&where={label:{isNull:true}}'),
      await fluent(
        queryUntyped('MNotes')
          .locale('de')
          .where({ label: { isNull: true } }),
      ),
    );
    deepStrictEqual(
      await wireNotes('order=[label]'),
      await fluent(queryUntyped('MNotes').orderBy('label')),
    );
  });
});

interface BlockScope {
  where(field: string, value: unknown): BlockScope;
}
interface BlockOps {
  has(block: string, build: (q: BlockScope) => BlockScope): BlockOps;
}

describe('the blocks wire forms mirror their fluent equivalents', () => {
  const pagesMeta = queryMetadata('MPages');

  async function wirePages(url: string): Promise<unknown[]> {
    const parsed = parseQueryParams(parseSearchParams(url), pagesMeta, DEFAULT_QUERY_GUARDS);
    return applyQuery(queryUntyped('MPages'), parsed).findMany();
  }

  it('a bare has', async () => {
    deepStrictEqual(
      await wirePages('where={content:{has:true}}&order=[title]'),
      await fluent(
        queryUntyped('MPages')
          .where({ content: { has: true } })
          .orderBy('title'),
      ),
    );
  });

  it('an empty', async () => {
    deepStrictEqual(
      await wirePages('where={content:{empty:true}}'),
      await fluent(queryUntyped('MPages').where({ content: { empty: true } })),
    );
  });

  it('a discriminator-only has', async () => {
    deepStrictEqual(
      await wirePages('where={content:{has:{block:MHero}}}&order=[title]'),
      await fluent(
        queryUntyped('MPages')
          .where({ content: { has: { block: 'MHero' } } })
          .orderBy('title'),
      ),
    );
  });

  it('a subfield condition, the fluent side driving the two-step collector', async () => {
    deepStrictEqual(
      await wirePages('where={content:{has:{block:MHero,title:{contains:Lau}}}}'),
      await fluent(
        queryUntyped('MPages').where(
          lowerField('content', (w: BlockOps) =>
            w.has('MHero', (q) => q.where('title', { contains: 'Lau' })),
          ),
        ),
      ),
    );
  });

  it('a negated has', async () => {
    deepStrictEqual(
      await wirePages('where={content:{not:{has:{block:MHero}}}}&order=[title]'),
      await fluent(
        queryUntyped('MPages')
          .where({ content: { not: { has: { block: 'MHero' } } } })
          .orderBy('title'),
      ),
    );
  });
});

const taggedMeta = queryMetadata('MTagged');

async function wireTagged(url: string): Promise<unknown[]> {
  const parsed = parseQueryParams(parseSearchParams(url), taggedMeta, DEFAULT_QUERY_GUARDS);
  return applyQuery(queryUntyped('MTagged'), parsed).findMany();
}

function titles(rows: unknown[]): string[] {
  return (rows as { title: string }[]).map((row) => row.title);
}

describe('the list membership wire forms mirror their fluent equivalents', () => {
  it('includes', async () => {
    const rows = await wireTagged('where={tags:{includes:news}}&order=[title]');
    deepStrictEqual(
      rows,
      await fluent(
        queryUntyped('MTagged')
          .where({ tags: { includes: 'news' } })
          .orderBy('title'),
      ),
    );
    deepStrictEqual(titles(rows), ['Ash', 'Birch']);
  });

  it('includesAll', async () => {
    const rows = await wireTagged('where={tags:{includesAll:[news,tech]}}');
    deepStrictEqual(
      rows,
      await fluent(queryUntyped('MTagged').where({ tags: { includesAll: ['news', 'tech'] } })),
    );
    deepStrictEqual(titles(rows), ['Ash']);
  });

  it('includesAny', async () => {
    const rows = await wireTagged('where={tags:{includesAny:[life,news]}}&order=[title]');
    deepStrictEqual(
      rows,
      await fluent(
        queryUntyped('MTagged')
          .where({ tags: { includesAny: ['life', 'news'] } })
          .orderBy('title'),
      ),
    );
    deepStrictEqual(titles(rows), ['Ash', 'Birch', 'Cedar']);
  });

  it('a negated includes leaves the null row out', async () => {
    const rows = await wireTagged('where={tags:{not:{includes:news}}}&order=[title]');
    deepStrictEqual(
      rows,
      await fluent(
        queryUntyped('MTagged')
          .where({ tags: { not: { includes: 'news' } } })
          .orderBy('title'),
      ),
    );
    deepStrictEqual(titles(rows), ['Cedar']);
  });
});

describe('readable: false splits wire and fluent on purpose', () => {
  it('the fluent where filters the hidden field; the identical wire where is invalidField', async () => {
    const rows = await fluent(queryUntyped('MTagged').where({ secret: 'shh' }).orderBy('title'));
    deepStrictEqual(titles(rows), ['Ash', 'Birch', 'Dune']);

    throws(
      () =>
        parseQueryParams(parseSearchParams('where={secret:shh}'), taggedMeta, DEFAULT_QUERY_GUARDS),
      (error: unknown) => {
        ok(error instanceof HTTPError);
        strictEqual(error.status, 400);
        deepStrictEqual(error.data, { code: 'invalidField', path: 'where.secret' });
        return true;
      },
    );
  });
});
