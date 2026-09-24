import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { QueryScope } from '../../../../src/ohne/query/wire/apply.ts';
import type { SearchParamValue } from '../../../../src/utils/index.ts';

import { useCollections } from '../../../../src/ohne/collections/use-collections.ts';
import { SQLiteDialect } from '../../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { buildDesiredSchema } from '../../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../../src/ohne/database/schema/sync.ts';
import { registerDatabase, registerDialect } from '../../../../src/ohne/database/use-database.ts';
import { field } from '../../../../src/ohne/fields/field.ts';
import { useFields } from '../../../../src/ohne/fields/use-fields.ts';
import { useLayers } from '../../../../src/ohne/layers/use-layers.ts';
import { freezeIR, type TargetReach } from '../../../../src/ohne/query/ir.ts';
import { queryMetadata } from '../../../../src/ohne/query/metadata.ts';
import { queryUntyped } from '../../../../src/ohne/query/query.ts';
import { applyQuery } from '../../../../src/ohne/query/wire/apply.ts';
import { resolveGuards } from '../../../../src/ohne/query/wire/guards.ts';
import { parseWireQuery } from '../../../../src/ohne/query/wire/reach.ts';

useLayers().add({
  path: '/reach-test',
  input: { collections: { locales: ['en', 'de'], defaultLocale: 'en' } },
});

useCollections().register('WrAuthors', {
  name: 'WrAuthors',
  collection: {
    fields: {
      name: field('text'),
      secret: field('text'),
      active: field('boolean'),
      boss: field('record', { collection: 'WrAuthors' }),
    },
  },
});
useCollections().register('WrTags', {
  name: 'WrTags',
  collection: { fields: { label: field('text') } },
});
useCollections().register('WrPosts', {
  name: 'WrPosts',
  collection: {
    fields: {
      title: field('text'),
      author: field('record', { collection: 'WrAuthors' }),
      tags: field('records', { collection: 'WrTags' }),
    },
  },
});
useCollections().register('WrNotes', {
  name: 'WrNotes',
  collection: {
    fields: { title: field('text', { translatable: true }), views: field('integer') },
  },
});
useCollections().register('WrPins', {
  name: 'WrPins',
  collection: { fields: { note: field('record', { collection: 'WrNotes' }) } },
});

const dialect = new SQLiteDialect();
const db = await dialect.connect(':memory:');
registerDialect(dialect);
registerDatabase(db);
await syncDatabase(db, dialect, {
  desired: buildDesiredSchema(useCollections(), useFields() as never),
});

const authors = queryUntyped('WrAuthors');
const anduin = (await authors.createOrThrow({ name: 'Anduin', secret: 's1', active: true }))
  .UUID as string;
const baine = (
  await authors.createOrThrow({ name: 'Baine', secret: 's2', active: false, boss: anduin })
).UUID as string;
const chen = (
  await authors.createOrThrow({ name: 'Chen', secret: 's3', active: true, boss: baine })
).UUID as string;
const news = (await queryUntyped('WrTags').createOrThrow({ label: 'news' })).UUID as string;
const misc = (await queryUntyped('WrTags').createOrThrow({ label: 'misc' })).UUID as string;
await queryUntyped('WrPosts').createOrThrow({ title: 'By Anduin', author: anduin, tags: [news] });
await queryUntyped('WrPosts').createOrThrow({
  title: 'By Baine',
  author: baine,
  tags: [news, misc],
});
await queryUntyped('WrPosts').createOrThrow({ title: 'By Chen', author: chen, tags: [misc] });
const noteA = (await queryUntyped('WrNotes').createOrThrow({ title: 'Note', views: 1 })).UUID;
await queryUntyped('WrNotes').createOrThrow({ title: 'Other', views: 2 });

const meta = queryMetadata('WrPosts');
const guards = resolveGuards();

type Answers = Record<string, QueryScope | false>;

function resolver(answers: Answers): {
  resolve: (collection: string) => Promise<QueryScope | false>;
  asked: string[];
} {
  const asked: string[] = [];
  return {
    asked,
    resolve: (collection) => {
      asked.push(collection);
      return Promise.resolve(answers[collection] ?? false);
    },
  };
}

async function read(
  params: Record<string, SearchParamValue>,
  answers: Answers,
): Promise<Record<string, unknown>[]> {
  const parsed = await parseWireQuery(params, meta, guards, resolver(answers).resolve);
  return applyQuery(queryUntyped('WrPosts').orderBy('title', 'asc'), parsed).findMany();
}

function pathOf(error: unknown): string | undefined {
  return (error as { data?: { path?: string } }).data?.path;
}

function messageOf(error: unknown): string | undefined {
  return (error as { message?: string }).message;
}

describe('parseWireQuery resolves the reach of every crossed collection', () => {
  it('asks once per collection a populate or conditioned has crosses into', async () => {
    const { resolve, asked } = resolver({ WrAuthors: {}, WrTags: {} });
    const parsed = await parseWireQuery(
      {
        populate: ['author', { tags: { select: ['label'] } }],
        where: { author: { has: { name: 'Anduin' } } },
      },
      meta,
      guards,
      resolve,
    );
    deepStrictEqual(asked.sort(), ['WrAuthors', 'WrTags']);
    deepStrictEqual([...(parsed.reach?.keys() ?? [])].sort(), ['WrAuthors', 'WrTags']);
  });

  it('asks nothing and carries no reach when the query crosses no collection', async () => {
    const { resolve, asked } = resolver({});
    const parsed = await parseWireQuery(
      { where: { title: { startsWith: 'By' } } },
      meta,
      guards,
      resolve,
    );
    deepStrictEqual(asked, []);
    strictEqual(parsed.reach, undefined);
  });

  it('refuses a target field outside its reach select, and every field of an unreachable target', async () => {
    await rejects(
      parseWireQuery(
        { populate: [{ author: { select: ['secret'] } }] },
        meta,
        guards,
        resolver({ WrAuthors: { select: ['name'] } }).resolve,
      ),
      (error) => pathOf(error) === 'populate[0].author.select[0]',
    );
    await rejects(
      parseWireQuery(
        { where: { author: { has: { name: 'Anduin' } } } },
        meta,
        guards,
        resolver({ WrAuthors: false }).resolve,
      ),
      (error) => pathOf(error) === 'where.author.name',
    );
  });

  it('refuses a `_translations` filter into a target whose reach reads per locale', async () => {
    const pins = queryMetadata('WrPins');
    const probe = { where: { note: { has: { _translations: { includes: 'de' } } } } };
    await rejects(
      parseWireQuery(
        probe,
        pins,
        guards,
        resolver({ WrNotes: { where: { title: 'Note' } } }).resolve,
      ),
      (error) => pathOf(error) === 'where.note._translations',
    );
    const open = await parseWireQuery(
      probe,
      pins,
      guards,
      resolver({ WrNotes: { where: { views: 1 } } }).resolve,
    );
    deepStrictEqual(open.where, probe.where);
  });

  it('names nothing about an unreachable target: a near miss and a wrong type read as unknown', async () => {
    const unreachable = resolver({ WrAuthors: false }).resolve;
    await rejects(
      parseWireQuery({ where: { author: { has: { secre: 'x' } } } }, meta, guards, unreachable),
      (error) => messageOf(error) === 'query.invalidField',
    );
    await rejects(
      parseWireQuery({ where: { author: { has: { active: 'x' } } } }, meta, guards, unreachable),
      (error) => messageOf(error) === 'query.invalidField',
    );
    await rejects(
      parseWireQuery({ populate: [{ author: { select: ['secre'] } }] }, meta, guards, unreachable),
      (error) => messageOf(error) === 'query.invalidField',
    );
  });

  it('leaves a malformed populate or where for the parse to refuse, resolving nothing', async () => {
    const { resolve, asked } = resolver({ WrAuthors: {} });
    await rejects(parseWireQuery({ populate: [{ author: 5 }] }, meta, guards, resolve));
    await rejects(parseWireQuery({ where: '{' }, meta, guards, resolve));
    deepStrictEqual(asked, ['WrAuthors']);
  });
});

describe('a wire read composes under its reach', () => {
  it('hydrates nothing from an unreachable target and drops its records elements', async () => {
    const rows = await read({ populate: ['author', 'tags'] }, { WrAuthors: false, WrTags: false });
    deepStrictEqual(
      rows.map((row) => [row.author, row.tags]),
      [
        [null, []],
        [null, []],
        [null, []],
      ],
    );
  });

  it('hydrates a target under its reach condition and select', async () => {
    const rows = await read(
      { populate: ['author'] },
      { WrAuthors: { where: { active: true }, select: ['name'] } },
    );
    deepStrictEqual(
      rows.map((row) => row.author),
      [{ name: 'Anduin' }, null, { name: 'Chen' }],
    );
  });

  it('keeps a reach condition whole when it probes a relation itself', async () => {
    const rows = await read(
      { populate: ['author'] },
      { WrAuthors: { where: { boss: { has: { name: 'Anduin' } } }, select: ['name'] } },
    );
    deepStrictEqual(
      rows.map((row) => row.author),
      [null, { name: 'Baine' }, null],
    );
  });

  it('matches a conditioned has only through the rows the reach admits', async () => {
    const answers: Answers = { WrAuthors: { where: { active: true } } };
    const admitted = await read(
      { where: { author: { has: { name: { startsWith: 'B' } } } } },
      answers,
    );
    deepStrictEqual(admitted, []);
    const reached = await read(
      { where: { author: { has: { name: { startsWith: 'A' } } } } },
      answers,
    );
    deepStrictEqual(
      reached.map((row) => row.title),
      ['By Anduin'],
    );
  });

  it('probes a records relation through the reach as well', async () => {
    const answers: Answers = { WrTags: { where: { label: 'misc' } } };
    const cut = await read({ where: { tags: { has: { label: 'news' } } } }, answers);
    deepStrictEqual(cut, []);
    const admitted = await read({ where: { tags: { has: { label: 'misc' } } } }, answers);
    deepStrictEqual(
      admitted.map((row) => row.title),
      ['By Baine', 'By Chen'],
    );
  });

  it('counts and paginates under the same reach as the row read', async () => {
    const parsed = await parseWireQuery(
      { where: { author: { has: { name: 'Anduin' } } } },
      meta,
      guards,
      resolver({ WrAuthors: { where: { active: false } } }).resolve,
    );
    const page = await applyQuery(queryUntyped('WrPosts'), parsed).paginate(1, 10);
    deepStrictEqual([page.total, page.records], [0, []]);
    strictEqual(await applyQuery(queryUntyped('WrPosts'), parsed).count(), 0);
  });

  it('leaves a bare has and the trusted scope untouched by the reach', async () => {
    const parsed = await parseWireQuery(
      { where: { author: { has: true } }, populate: ['author'] },
      meta,
      guards,
      resolver({ WrAuthors: false }).resolve,
    );
    const rows = await applyQuery(queryUntyped('WrPosts').orderBy('title', 'asc'), parsed, {
      where: { author: { has: { name: 'Baine' } } },
    }).findMany();
    deepStrictEqual(
      rows.map((row) => [row.title, row.author]),
      [['By Baine', null]],
    );
  });

  it('fails closed on a target the reach never named', async () => {
    const rows = await queryUntyped('WrPosts')
      .wire({ author: { has: { name: 'Anduin' } } }, new Map())
      .populate('tags')
      .findMany();
    deepStrictEqual(rows, []);
    const populated = await queryUntyped('WrPosts')
      .wire(null, new Map())
      .populate('tags')
      .findMany();
    deepStrictEqual(
      populated.map((row) => row.tags),
      [[], [], []],
    );
  });

  it('plucks a column under a wire condition over a translatable field', async () => {
    const plucked = await queryUntyped('WrNotes')
      .wire({ title: { startsWith: 'N' } }, new Map())
      .pluck('UUID');
    deepStrictEqual(plucked, [noteA]);
  });

  it('folds the wire condition into a write, unscoped', async () => {
    const parsed = await parseWireQuery(
      { where: { title: 'By Chen' }, populate: ['tags'] },
      meta,
      guards,
      resolver({ WrTags: false }).resolve,
    );
    const updated = await applyQuery(queryUntyped('WrPosts'), parsed).updateOrThrow({
      title: 'By Chen!',
    });
    deepStrictEqual(
      updated.map((row) => row.title),
      ['By Chen!'],
    );
    await queryUntyped('WrPosts').where({ title: 'By Chen!' }).updateOrThrow({ title: 'By Chen' });
  });

  it('freezes each reach entry inside a frozen IR', () => {
    const reach = new Map<string, TargetReach>([
      ['WrAuthors', { condition: null, select: ['name'] }],
      ['WrTags', false],
    ]);
    const ir = freezeIR({
      collection: 'WrPosts',
      conditions: [],
      select: null,
      order: [],
      limit: null,
      offset: null,
      populate: [],
      locale: null,
      wire: { condition: null, reach },
      unscoped: false,
    });
    ok(Object.isFrozen(ir.wire));
    ok(Object.isFrozen(ir.wire?.reach.get('WrAuthors')));
    ok(Object.isFrozen((ir.wire?.reach.get('WrAuthors') || {}).select));
  });
});
