import { ok, strictEqual } from 'node:assert';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { useCollections } from '../../../src/ohne/collections/use-collections.ts';
import { field } from '../../../src/ohne/fields/field.ts';
import { generateDatabase, loadLayers, useLayers } from '../../../src/ohne/index.ts';
import { queryMetadata } from '../../../src/ohne/query/metadata.ts';

const FRAMEWORK = join(import.meta.dirname, '..', '..', '..');

useCollections().register('QUsers', {
  name: 'QUsers',
  collection: { fields: { name: field('text') } },
});
useCollections().register('QTags', {
  name: 'QTags',
  collection: { fields: { label: field('text') } },
});
useCollections().register('QPosts', {
  name: 'QPosts',
  collection: {
    fields: {
      title: field('text'),
      views: field('integer'),
      summary: field('text', { nullable: true }),
      author: field('record', { collection: 'QUsers' }),
      tags: field('records', { collection: 'QTags' }),
      meta: field('object', { fields: { note: field('text') } }),
      sections: field('repeater', { fields: { label: field('text') } }),
    },
  },
});

describe('the generated query-field table mirrors the runtime metadata', () => {
  const fields = queryMetadata('QPosts').fields;

  it('marks the identity and system entries', () => {
    strictEqual(fields.UUID?.id, true);
    strictEqual(fields._updatedAt?.kind, 'column');
    strictEqual(fields._updatedAt?.logicalType, 'integer');
  });

  it('marks columns with their type and nullability', () => {
    strictEqual(fields.title?.kind, 'column');
    strictEqual(fields.title?.logicalType, 'text');
    strictEqual(fields.title?.nullable, false);
    strictEqual(fields.summary?.nullable, true);
  });

  it('marks a record with its target and force-nullability', () => {
    strictEqual(fields.author?.kind, 'record');
    strictEqual(fields.author?.target, 'QUsers');
    strictEqual(fields.author?.nullable, true);
  });

  it('marks a records relation with its target', () => {
    strictEqual(fields.tags?.kind, 'records');
    strictEqual(fields.tags?.target, 'QTags');
  });

  it('marks the composite kinds', () => {
    strictEqual(fields.meta?.kind, 'childOne');
    strictEqual(fields.sections?.kind, 'childMany');
  });
});

describe('the typed builder narrows in a consumer app', () => {
  let root: string;

  before(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'ohne-query-builder-')));
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
    useLayers().clear();
  });

  function write(dir: string, relative: string, content: string): void {
    const file = join(dir, relative);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, content);
  }

  it('emits the field table and typechecks the whole read surface', async () => {
    const app = join(root, 'app');
    mkdirSync(app, { recursive: true });
    writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'app', type: 'module' }));
    writeFileSync(join(app, 'ohne.config.ts'), 'export default {};\n');
    mkdirSync(join(app, 'node_modules', '@types'), { recursive: true });
    symlinkSync(FRAMEWORK, join(app, 'node_modules', 'ohne'), 'dir');
    symlinkSync(
      join(FRAMEWORK, 'node_modules', '@types', 'node'),
      join(app, 'node_modules', '@types', 'node'),
      'dir',
    );
    writeFileSync(
      join(app, 'tsconfig.json'),
      JSON.stringify({
        extends: 'ohne/tsconfig.node.json',
        include: ['**/*.ts', '.ohne/shared/**/*.ts', '.ohne/node/**/*.ts'],
      }),
    );

    write(
      app,
      'collections/Users.ts',
      "import { defineCollection, field } from 'ohne';\n" +
        "export default defineCollection({ fields: { name: field('text') } });\n",
    );
    write(
      app,
      'collections/Tags.ts',
      "import { defineCollection, field } from 'ohne';\n" +
        "export default defineCollection({ fields: { label: field('text') } });\n",
    );
    write(
      app,
      'collections/Posts.ts',
      "import { defineCollection, field } from 'ohne';\n" +
        'export default defineCollection({ fields: {\n' +
        "  title: field('text'),\n" +
        "  views: field('integer'),\n" +
        "  featured: field('boolean'),\n" +
        "  summary: field('text', { nullable: true }),\n" +
        "  author: field('record', { collection: 'Users' }),\n" +
        "  tags: field('records', { collection: 'Tags' }),\n" +
        "  meta: field('object', { fields: { note: field('text') } }),\n" +
        "  sections: field('repeater', { fields: { heading: field('text') } }),\n" +
        '} });\n',
    );

    write(app, 'typing.ts', TYPING);

    await loadLayers(app);
    const paths = await generateDatabase(app);
    const shared = readFileSync(paths[0] ?? '', 'utf8');

    ok(shared.includes('export interface GeneratedQueryFields {'));
    ok(shared.includes('UUID: { scalar: string; id: true };'));
    ok(shared.includes('title: { scalar: string };'));
    ok(shared.includes('views: { scalar: number };'));
    ok(shared.includes('summary: { scalar: string; nullable: true };'));
    ok(shared.includes("author: { scalar: string; record: 'Users'; nullable: true };"));
    ok(shared.includes("tags: { records: 'Tags' };"));
    ok(shared.includes("meta: { child: 'one'; fields: {"));
    ok(shared.includes("sections: { child: 'many'; fields: {"));

    execFileSync(
      process.execPath,
      [join(FRAMEWORK, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', app],
      { encoding: 'utf8' },
    );
  });
});

/**
 * The consumer typing.ts: positive uses that must compile, and `@ts-expect-error` cases that must not.
 */
const TYPING = `import { query } from 'ohne';

export async function reads(): Promise<void> {
  const all = await query('Posts').findMany();
  const row = all[0]!;
  const t: string = row.title;
  const v: number = row.views;
  const f: boolean = row.featured;
  const s: string | null = row.summary;
  const a: string | null = row.author;
  const g: string[] = row.tags;
  const u: string = row.UUID;
  const w: number = row._updatedAt;
  void [t, v, f, s, a, g, u, w];

  const narrowed = await query('Posts').select('title', 'views').findMany();
  const n = narrowed[0]!;
  const nt: string = n.title;
  const nv: number = n.views;
  void [nt, nv];
  // @ts-expect-error author was not selected
  void n.author;

  const populated = await query('Posts').populate('author').findMany();
  const author = populated[0]!.author;
  if (author) {
    const an: string = author.name;
    void an;
  }

  const withTags = await query('Posts').populate('tags').findMany();
  const tag = withTags[0]!.tags[0];
  if (tag) {
    const tl: string = tag.label;
    void tl;
  }

  const titles: string[] = await query('Posts').pluck('title');
  const authors = await query('Posts').populate('author').pluck('author');
  const one = authors[0];
  if (one) {
    const on: string = one.name;
    void on;
  }
  void titles;

  await query('Posts').where('title', 'ohne').findMany();
  await query('Posts').where('views', 100).findMany();
  await query('Posts').where('featured', true).findMany();
  await query('Posts').where('author', 'some-uuid').findMany();
  await query('Posts').where('views', (c) => c.atLeast(100)).findMany();
  await query('Posts').where('views', (c) => c.in([100, 200])).findMany();
  await query('Posts').where('views', (c) => c.greaterThan(1)).findMany();
  await query('Posts').where('views', (c) => c.lessThan(9)).findMany();
  await query('Posts').where('views', (c) => c.atMost(9)).findMany();
  await query('Posts').where('views', (c) => c.atLeast(100).or.equalsTo(0)).findMany();
  await query('Posts').where('title', (c) => c.startsWith('The')).findMany();
  await query('Posts').where('title', (c) => c.endsWith('guide')).findMany();
  await query('Posts').where('title', (c) => c.like('draft-%')).findMany();
  await query('Posts').where('title', (c) => c.contains('oh')).findMany();
  await query('Posts').where('title', (c) => c.not.equalsTo('x')).findMany();
  await query('Posts').where('summary', (c) => c.isNull()).findMany();
  await query('Posts').where('author', (c) => c.has((q) => q.where('name', 'Ada'))).findMany();
  await query('Posts').where('author', (c) => c.has()).findMany();
  await query('Posts').where('tags', (c) => c.empty()).findMany();
  await query('Posts')
    .whereAny((grp) => [grp.where('featured', true), grp.where('views', (c) => c.atLeast(1000))])
    .findMany();
  await query('Posts').orderBy('views', 'desc').limit(10).offset(5).count();
  await query('Posts').exists();
  await query('Posts').paginate(1, 20);
}

export async function writes(): Promise<void> {
  const created = await query('Posts').create({ title: 'x', views: 1, featured: true });
  if (created.ok) {
    const ct: string = created.record.title;
    void ct;
  }

  const updated = await query('Posts').where('title', 'x').update({ views: 5 });
  if (updated.ok) {
    const uv: number = updated.records[0]!.views;
    void uv;
  }

  const rows = await query('Posts').where('title', 'x').updateOrThrow({ summary: null });
  const rt: string = rows[0]!.title;
  void rt;

  await query('Posts')
    .where('title', 'x')
    .update({ tags: ['a'], meta: null, sections: [{ UUID: 's1', heading: 'h' }, { heading: 'new' }] });

  const { deleted } = await query('Posts').where('views', (c) => c.atLeast(1)).delete();
  const d: number = deleted;
  void d;
}

// @ts-expect-error title is text, not a number
query('Posts').where('title', 123);
// @ts-expect-error null is never a value; use isNull
query('Posts').where('title', null);
// @ts-expect-error text operators do not apply to an integer column
query('Posts').where('views', (c) => c.contains('x'));
// @ts-expect-error ordering does not apply to a record foreign key
query('Posts').where('author', (c) => c.greaterThan('x'));
// @ts-expect-error the text trio does not apply to a record
query('Posts').where('author', (c) => c.contains('x'));
// @ts-expect-error ordering does not apply to the UUID identity column
query('Posts').where('UUID', (c) => c.greaterThan('x'));
// @ts-expect-error a records relation has no equality shorthand
query('Posts').where('tags', 'x');
// @ts-expect-error a callback must apply an operator
query('Posts').where('views', (c) => c);
// @ts-expect-error unknown field
query('Posts').where('nope', 'x');
// @ts-expect-error unknown select field
query('Posts').select('nope');
// @ts-expect-error a records field cannot be ordered
query('Posts').orderBy('tags');
// @ts-expect-error only relation fields can be populated
query('Posts').populate('title');
// @ts-expect-error unknown collection
query('Nope');
// @ts-expect-error update is not available before a filter narrows the query
query('Posts').update({ views: 1 });
// @ts-expect-error delete is not available before a filter narrows the query
query('Posts').delete();
// @ts-expect-error create is not available once a filter is in place
query('Posts').where('title', 'x').create({ title: 'y', views: 1, featured: true });
// @ts-expect-error create is not available after a refinement strips the write terminals
query('Posts').select('title').create({ title: 'y', views: 1, featured: true });
// @ts-expect-error a refinement strips the write terminals for the rest of the chain
query('Posts').where('title', 'x').select('title').update({ views: 1 });
// @ts-expect-error views is an integer, not a string
query('Posts').where('title', 'x').update({ views: 'lots' });
// @ts-expect-error a create item carries no UUID
query('Posts').create({ title: 'y', views: 1, featured: true, sections: [{ UUID: 's', heading: 'h' }] });
// @ts-expect-error a provided repeater item still requires its non-optional subfields
query('Posts').where('title', 'x').update({ sections: [{ UUID: 's' }] });
`;
