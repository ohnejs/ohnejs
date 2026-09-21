import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import type { UntypedQueryBuilder } from '../../../../src/ohne/query/untyped.ts';

import { useCollections } from '../../../../src/ohne/collections/use-collections.ts';
import { SQLiteDialect } from '../../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { buildDesiredSchema } from '../../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../../src/ohne/database/schema/sync.ts';
import { registerDatabase, registerDialect } from '../../../../src/ohne/database/use-database.ts';
import { field } from '../../../../src/ohne/fields/field.ts';
import { useFields } from '../../../../src/ohne/fields/use-fields.ts';
import { useLayers } from '../../../../src/ohne/layers/use-layers.ts';
import { queryUntyped } from '../../../../src/ohne/query/query.ts';

useLayers().add({
  path: '/locale-read',
  input: { collections: { locales: ['en', 'de'], defaultLocale: 'en' } },
});

useCollections().register('LAuthors', {
  name: 'LAuthors',
  collection: {
    fields: {
      name: field('text', { translatable: true }),
      handle: field('text'),
    },
  },
});
useCollections().register('LTags', {
  name: 'LTags',
  collection: {
    fields: {
      label: field('text'),
      posts: field('records', { collection: 'LPosts', inverse: 'tags' }),
    },
  },
});
useCollections().register('LPosts', {
  name: 'LPosts',
  collection: {
    fields: {
      title: field('text', { translatable: true }),
      subtitle: field('text', { translatable: true, nullable: true }),
      views: field('integer'),
      author: field('record', { collection: 'LAuthors', translatable: true }),
      tags: field('records', { collection: 'LTags', translatable: true }),
      reviewers: field('records', {
        collection: 'LAuthors',
        translatable: true,
      }),
      meta: field('object', {
        translatable: true,
        fields: { note: field('text') },
      }),
      sections: field('repeater', {
        translatable: true,
        fields: { heading: field('text') },
      }),
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

async function create(collection: string, input: Record<string, unknown>): Promise<string> {
  const record = await queryUntyped(collection).createOrThrow(input);
  return record.UUID as string;
}

async function translateDE(uuid: string, input: Record<string, unknown>): Promise<void> {
  await queryUntyped('LPosts').locale('de').where({ UUID: uuid }).updateOrThrow(input);
}

const anduin = await create('LAuthors', { name: 'Anduin', handle: 'anduin' });
const arthas = await create('LAuthors', { name: 'Arthas', handle: 'arthas' });
await queryUntyped('LAuthors').locale('de').where({ UUID: anduin }).updateOrThrow({
  name: 'Anduin (de)',
});

const red = await create('LTags', { label: 'red' });
const green = await create('LTags', { label: 'green' });
const blue = await create('LTags', { label: 'blue' });

const first = await create('LPosts', {
  title: 'First',
  subtitle: 'intro',
  views: 100,
  author: anduin,
  tags: [red, green],
  reviewers: [anduin, arthas],
  meta: { note: 'note-en' },
  sections: [{ heading: 'S1' }, { heading: 'S2' }],
});
await translateDE(first, {
  title: 'Erste',
  subtitle: 'einfuehrung',
  author: arthas,
  tags: [green, blue],
  reviewers: [anduin],
  meta: { note: 'note-de' },
  sections: [{ heading: 'DE-S1' }],
});

const second = await create('LPosts', {
  title: 'Second',
  views: 50,
  author: arthas,
  tags: [red],
});

const third = await create('LPosts', {
  title: 'Third',
  subtitle: 'three',
  views: 200,
});
await translateDE(third, {
  title: 'Dritte',
  subtitle: null,
  author: anduin,
  tags: [red],
});

const posts = (): UntypedQueryBuilder => queryUntyped('LPosts');
const de = (): UntypedQueryBuilder => queryUntyped('LPosts').locale('de');

async function uuids(builder: UntypedQueryBuilder): Promise<unknown[]> {
  return (await builder.orderBy('views').findMany()).map((row) => row.UUID);
}

describe('locale views', () => {
  it('serves the default locale unlocaled, identical to an explicit locale', async () => {
    const unlocaled = await posts().where({ UUID: first }).findFirst();
    strictEqual(unlocaled?.title, 'First');
    strictEqual(unlocaled.subtitle, 'intro');
    strictEqual(unlocaled.author, anduin);
    deepStrictEqual(unlocaled.tags, [red, green]);
    deepStrictEqual(unlocaled.reviewers, [anduin, arthas]);
    strictEqual((unlocaled.meta as { note: string }).note, 'note-en');
    deepStrictEqual(
      (unlocaled.sections as { heading: string }[]).map((section) => section.heading),
      ['S1', 'S2'],
    );
    const explicit = await posts().locale('en').where({ UUID: first }).findFirst();
    deepStrictEqual(unlocaled, explicit);
  });

  it('serves the de values across scalars, relations, and composites', async () => {
    const record = await de().where({ UUID: first }).findFirst();
    strictEqual(record?.title, 'Erste');
    strictEqual(record.subtitle, 'einfuehrung');
    strictEqual(record.views, 100);
    strictEqual(record.author, arthas);
    deepStrictEqual(record.tags, [green, blue]);
    deepStrictEqual(record.reviewers, [anduin]);
    strictEqual((record.meta as { note: string }).note, 'note-de');
    deepStrictEqual(
      (record.sections as { heading: string }[]).map((section) => section.heading),
      ['DE-S1'],
    );
  });

  it('reads a missing translation as null scalars, empty lists, and a null object', async () => {
    const record = await de().where({ UUID: second }).findFirst();
    ok(record);
    const { _updatedAt, ...rest } = record;
    strictEqual(typeof _updatedAt, 'number');
    deepStrictEqual(rest, {
      UUID: second,
      _translations: ['en'],
      title: null,
      subtitle: null,
      views: 50,
      author: null,
      tags: [],
      reviewers: [],
      meta: null,
      sections: [],
    });
  });
});

describe('read terminals agree on the effective locale', () => {
  it('findMany, count, and exists see the same de matches', async () => {
    const condition = { title: { contains: 'te' } };
    deepStrictEqual(await uuids(de().where(condition)), [first, third]);
    strictEqual(await de().where(condition).count(), 2);
    strictEqual(await de().where(condition).exists(), true);
    deepStrictEqual(await uuids(posts().where(condition)), []);
    strictEqual(await posts().where(condition).count(), 0);
    strictEqual(await posts().where(condition).exists(), false);
  });

  it('paginate totals the de matches and reads the page rows at de', async () => {
    const page = await de()
      .where({ title: { contains: 'te' } })
      .orderBy('views')
      .paginate(1, 1);
    strictEqual(page.total, 2);
    strictEqual(page.lastPage, 2);
    deepStrictEqual(
      page.records.map((row) => row.title),
      ['Erste'],
    );
  });
});

describe('where per locale', () => {
  it('matches a translatable equality only at its locale', async () => {
    deepStrictEqual(await uuids(de().where({ title: 'Erste' })), [first]);
    deepStrictEqual(await uuids(posts().where({ title: 'Erste' })), []);
    deepStrictEqual(await uuids(posts().where({ title: 'First' })), [first]);
    deepStrictEqual(await uuids(de().where({ title: 'First' })), []);
  });

  it('matches isNull on missing translations and stored nulls alike', async () => {
    deepStrictEqual(await uuids(de().where({ title: { isNull: true } })), [second]);
    deepStrictEqual(await uuids(de().where({ subtitle: { isNull: true } })), [second, third]);
    deepStrictEqual(await uuids(posts().where({ subtitle: { isNull: true } })), [second]);
  });

  it('returns the same rows for a plain-field condition at every locale', async () => {
    const condition = { views: { atLeast: 100 } };
    deepStrictEqual(await uuids(posts().where(condition)), [first, third]);
    deepStrictEqual(await uuids(de().where(condition)), [first, third]);
  });
});

describe('orderBy on a translatable column', () => {
  it('sorts missing translations as nulls, first ascending', async () => {
    deepStrictEqual(await de().orderBy('title').pluck('views'), [50, 200, 100]);
  });
});

describe('pluck per locale', () => {
  it('plucks a translatable column at the effective locale', async () => {
    deepStrictEqual(await posts().orderBy('views').pluck('title'), ['Second', 'First', 'Third']);
    deepStrictEqual(await de().orderBy('views').pluck('title'), [null, 'Erste', 'Dritte']);
  });

  it('plucks a translatable record foreign key at the effective locale', async () => {
    deepStrictEqual(await posts().orderBy('views').pluck('author'), [arthas, anduin, null]);
    deepStrictEqual(await de().orderBy('views').pluck('author'), [null, arthas, anduin]);
  });

  it('plucks a populated relation hydrated at the query locale', async () => {
    const [author] = await de().where({ UUID: third }).populate('author').pluck('author');
    strictEqual((author as { name: string }).name, 'Anduin (de)');
  });
});

describe('select on a locale-scoped chain', () => {
  it('returns the plain values when narrowed to plain fields only', async () => {
    const rows = await de().select('views').orderBy('views').findMany();
    deepStrictEqual(rows, [{ views: 50 }, { views: 100 }, { views: 200 }]);
  });

  it('keeps unselected scoped lists out of the rows, the selected column at its locale', async () => {
    const rows = await de().select('title').orderBy('views').findMany();
    deepStrictEqual(rows, [{ title: null }, { title: 'Erste' }, { title: 'Dritte' }]);
  });
});

describe('populate per locale', () => {
  it('swaps a record foreign key for the target read at the query locale', async () => {
    const en = await posts().where({ UUID: first }).populate('author').findFirst();
    ok(en);
    strictEqual((en.author as { name: string }).name, 'Anduin');
    const record = await de().where({ UUID: third }).populate('author').findFirst();
    ok(record);
    strictEqual((record.author as { name: string }).name, 'Anduin (de)');
  });

  it('reads a populated untranslated target with its translatable fields null', async () => {
    const record = await de().where({ UUID: first }).populate('author').findFirst();
    ok(record);
    const author = record.author as {
      UUID: string;
      name: string | null;
      handle: string;
    };
    strictEqual(author.UUID, arthas);
    strictEqual(author.name, null);
    strictEqual(author.handle, 'arthas');
  });

  it('swaps a records list for targets read at the query locale', async () => {
    const en = await posts().where({ UUID: first }).populate('reviewers').findFirst();
    ok(en);
    deepStrictEqual(
      (en.reviewers as { name: string }[]).map((reviewer) => reviewer.name),
      ['Anduin', 'Arthas'],
    );
    const record = await de().where({ UUID: first }).populate('reviewers').findFirst();
    ok(record);
    const reviewers = record.reviewers as { UUID: string; name: string }[];
    deepStrictEqual(
      reviewers.map((reviewer) => [reviewer.UUID, reviewer.name]),
      [[anduin, 'Anduin (de)']],
    );
  });
});

describe('has per locale', () => {
  it("matches a condition on the target's translatable field per locale", async () => {
    deepStrictEqual(await uuids(posts().where({ author: { has: { name: 'Anduin' } } })), [first]);
    deepStrictEqual(await uuids(de().where({ author: { has: { name: 'Anduin (de)' } } })), [third]);
    deepStrictEqual(await uuids(de().where({ author: { has: { name: 'Anduin' } } })), []);
  });

  it("respects the locale's links over a locale-scoped junction", async () => {
    deepStrictEqual(await uuids(posts().where({ tags: { has: { label: 'red' } } })), [
      second,
      first,
    ]);
    deepStrictEqual(await uuids(de().where({ tags: { has: { label: 'red' } } })), [third]);
    deepStrictEqual(await uuids(de().where({ tags: { has: { label: 'blue' } } })), [first]);
    deepStrictEqual(await uuids(posts().where({ tags: { has: { label: 'blue' } } })), []);
  });
});

describe('the inverse side of a locale-scoped junction', () => {
  it("reads only the default locale's links from a non-translatable collection", async () => {
    const redTag = await queryUntyped('LTags').where({ UUID: red }).findFirst();
    deepStrictEqual(redTag?.posts, [first, second]);
    const greenTag = await queryUntyped('LTags').where({ UUID: green }).findFirst();
    deepStrictEqual(greenTag?.posts, [first]);
    const blueTag = await queryUntyped('LTags').where({ UUID: blue }).findFirst();
    deepStrictEqual(blueTag?.posts, []);
  });

  it('does not make the inverse collection translatable', () => {
    throws(() => queryUntyped('LTags').locale('de'));
  });
});
