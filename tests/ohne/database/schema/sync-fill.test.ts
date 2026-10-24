import { deepStrictEqual, doesNotMatch, match, ok, rejects, strictEqual } from 'node:assert';
import { afterEach, describe, it } from 'node:test';

import type { CollectionMeta } from '../../../../src/ohne/collections/use-collections.ts';
import type { DatabaseAdapter } from '../../../../src/ohne/database/adapter.ts';
import type {
  Migration,
  MigrationTransform,
} from '../../../../src/ohne/database/migrations/define-migration.ts';
import type { MigrationMeta } from '../../../../src/ohne/database/migrations/use-migrations.ts';
import type { FieldTypeMeta } from '../../../../src/ohne/fields/use-fields.ts';
import type { Registry } from '../../../../src/utils/index.ts';

import { useCollections } from '../../../../src/ohne/collections/use-collections.ts';
import { useMigrations } from '../../../../src/ohne/database/migrations/use-migrations.ts';
import { buildDesiredSchema } from '../../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../../src/ohne/database/schema/sync.ts';
import { syncProjectDatabase } from '../../../../src/ohne/database/sync-project.ts';
import { closeDatabases, useDatabase } from '../../../../src/ohne/database/use-database.ts';
import { useEnv } from '../../../../src/ohne/env/use-env.ts';
import { isOhneError } from '../../../../src/ohne/error/ohne-error.ts';
import { field } from '../../../../src/ohne/fields/field.ts';
import { useFields } from '../../../../src/ohne/fields/use-fields.ts';
import { usePrinter } from '../../../../src/ohne/printer/use-printer.ts';
import { queryUntyped } from '../../../../src/ohne/query/query.ts';
import { createRegistry } from '../../../../src/utils/index.ts';
import { connectTest, dialect, memoryURL } from '../../../_dialect.ts';

function bodyOf(error: unknown): string {
  ok(isOhneError(error));
  strictEqual(error.title, 'Destructive sync refused');
  return Array.isArray(error.body) ? error.body.join('\n') : (error.body ?? '');
}

function refusalMatching(pattern: RegExp): (error: unknown) => boolean {
  return (error: unknown) => {
    match(bodyOf(error), pattern);
    return true;
  };
}

function desiredOf(...metas: CollectionMeta[]): ReturnType<typeof buildDesiredSchema> {
  const registry = createRegistry<CollectionMeta>();
  for (const meta of metas) registry.register(meta.name, meta);
  return buildDesiredSchema(registry, useFields() as Registry<FieldTypeMeta>);
}

function meta(name: string, migration: Migration): MigrationMeta {
  return { name, migration, file: `/app/migrations/${name.split('/')[1]}.ts` };
}

function site(fields: Record<string, unknown>): ReturnType<typeof buildDesiredSchema> {
  return desiredOf({ name: 'Site', collection: { singleton: true, fields } } as CollectionMeta);
}

const before = site({ title: field('text', { default: 'Home' }) });
const after = site({
  title: field('text', { default: 'Home' }),
  autoRedirect: field('boolean', { default: true }),
});

const fill = (transform: MigrationTransform): MigrationMeta =>
  meta('app/2026-10-auto-redirect', {
    from: null,
    to: { collection: 'Site', field: 'autoRedirect' },
    transform,
  });

async function insertSite(db: DatabaseAdapter, uuid: string): Promise<void> {
  await db.run('INSERT INTO "Site" ("UUID", "_updatedAt", "title") VALUES (?, ?, ?)', [
    uuid,
    0,
    'Home',
  ]);
}

function stamps(db: DatabaseAdapter): Promise<{ name: string; status: string; reason: string }[]> {
  return db.query('SELECT "name", "status", "reason" FROM "ohne_migrations" ORDER BY "name"');
}

describe('syncDatabase with a fill migration', () => {
  it('refuses a new required field over live rows, pointing at a fill', async () => {
    const db = await connectTest();
    await syncDatabase(db, dialect, { desired: before });
    await insertSite(db, 's1');
    await rejects(syncDatabase(db, dialect, { desired: after }), (error: unknown) => {
      const body = bodyOf(error);
      match(body, /These cannot apply even under force:/);
      match(body, /new column `Site.autoRedirect` is NOT NULL but `Site` holds `1` row/);
      match(body, /fill migration: `from: null`, `to` the field, `transform` the value\./);
      match(body, /`force` cannot resolve them\./);
      doesNotMatch(body, /move migration/);
      return true;
    });
    await rejects(
      syncDatabase(db, dialect, { desired: after, force: true }),
      refusalMatching(/is NOT NULL but `Site` holds/),
    );
    await db.close();
  });

  it('boots in one sync with the fill, stamping it applied', async () => {
    const db = await connectTest();
    await syncDatabase(db, dialect, { desired: before });
    await insertSite(db, 's1');
    const migrations = [fill(() => true)];
    const report = await syncDatabase(db, dialect, { desired: after, migrations });
    deepStrictEqual(report, { deletions: [], warnings: [] });
    deepStrictEqual(await db.query('SELECT "autoRedirect" FROM "Site"'), [
      Object.assign(Object.create(null), { autoRedirect: 1 }),
    ]);
    const live = await dialect.describeTable(db, 'Site');
    deepStrictEqual(
      live.columns.find((column) => column.name === 'autoRedirect'),
      { name: 'autoRedirect', type: 'integer', notNull: true },
    );
    deepStrictEqual(await stamps(db), [
      Object.assign(Object.create(null), {
        name: 'app/2026-10-auto-redirect',
        status: 'applied',
        reason: null,
      }),
    ]);
    await syncDatabase(db, dialect, { desired: after, migrations });
    strictEqual((await stamps(db)).length, 1);
    await db.close();
  });

  it('adds a required object with several required subfields, one fill each', async () => {
    const db = await connectTest();
    await syncDatabase(db, dialect, { desired: before });
    await insertSite(db, 's1');
    const withSEO = site({
      title: field('text', { default: 'Home' }),
      seo: field('object', { fields: { title: field('text'), description: field('text') } }),
    });
    const table = withSEO.find((item) => item.derived?.path.join('.') === 'seo')?.name ?? '';
    await syncDatabase(db, dialect, {
      desired: withSEO,
      migrations: [
        meta('app/2026-10-seo-title', {
          from: null,
          to: { collection: 'Site', field: 'seo.title' },
          transform: () => 'Stormwind',
        }),
        meta('app/2026-10-seo-description', {
          from: null,
          to: { collection: 'Site', field: 'seo.description' },
          transform: () => 'The capital of the Alliance.',
        }),
      ],
    });
    deepStrictEqual(await db.query(`SELECT "title", "description" FROM "${table}"`), [
      Object.assign(Object.create(null), {
        title: 'Stormwind',
        description: 'The capital of the Alliance.',
      }),
    ]);
    const live = await dialect.describeTable(db, table);
    ok(
      live.columns
        .filter((column) => ['title', 'description'].includes(column.name))
        .every((column) => column.notNull),
    );
    await db.close();
  });

  it('refuses a required object whose second subfield no fill gave a value', async () => {
    const db = await connectTest();
    await syncDatabase(db, dialect, { desired: before });
    await insertSite(db, 's1');
    const withSEO = site({
      title: field('text', { default: 'Home' }),
      seo: field('object', { fields: { title: field('text'), description: field('text') } }),
    });
    await rejects(
      syncDatabase(db, dialect, {
        desired: withSEO,
        migrations: [
          meta('app/2026-10-seo-title', {
            from: null,
            to: { collection: 'Site', field: 'seo.title' },
            transform: () => 'Stormwind',
          }),
        ],
      }),
      refusalMatching(/\.description` becomes NOT NULL over `1` NULL row/),
    );
    ok(!(await dialect.listTables(db)).includes('ohne_migrations'));
    await db.close();
  });

  it('rolls the fill and its stamp back when a row stays NULL', async () => {
    const db = await connectTest();
    await syncDatabase(db, dialect, { desired: before });
    await insertSite(db, 's1');
    await insertSite(db, 's2');
    await rejects(
      syncDatabase(db, dialect, {
        desired: after,
        migrations: [fill((_value, row) => (row.UUID === 's1' ? true : undefined))],
      }),
      refusalMatching(/`Site.autoRedirect` becomes NOT NULL over `1` NULL row/),
    );
    ok(!(await dialect.listTables(db)).includes('ohne_migrations'));
    const live = await dialect.describeTable(db, 'Site');
    ok(live.columns.every((column) => column.name !== 'autoRedirect'));
    await db.close();
  });

  it('refuses a constant fill under a new unique, the duplicate group named', async () => {
    const db = await connectTest();
    const posts = desiredOf({ name: 'Posts', collection: { fields: {} } } as CollectionMeta);
    await syncDatabase(db, dialect, { desired: posts });
    await db.run('INSERT INTO "Posts" ("UUID", "_updatedAt") VALUES (?, ?), (?, ?)', [
      'p1',
      0,
      'p2',
      0,
    ]);
    const slugged = desiredOf({
      name: 'Posts',
      collection: { fields: { slug: field('text', { unique: true }) } },
    } as CollectionMeta);
    await rejects(
      syncDatabase(db, dialect, {
        desired: slugged,
        migrations: [
          meta('app/2026-10-slug', {
            from: null,
            to: { collection: 'Posts', field: 'slug' },
            transform: () => 'post',
          }),
        ],
      }),
      refusalMatching(/covers `1` duplicate group/),
    );
    await syncDatabase(db, dialect, {
      desired: slugged,
      migrations: [
        meta('app/2026-10-slug', {
          from: null,
          to: { collection: 'Posts', field: 'slug' },
          transform: (_value, row) => `post-${String(row.UUID)}`,
        }),
      ],
    });
    deepStrictEqual(await db.query('SELECT "slug" FROM "Posts" ORDER BY "UUID"'), [
      Object.assign(Object.create(null), { slug: 'post-p1' }),
      Object.assign(Object.create(null), { slug: 'post-p2' }),
    ]);
    await db.close();
  });

  it('rolls a dry run back, the live schema and the stamps untouched', async () => {
    const db = await connectTest();
    await syncDatabase(db, dialect, { desired: before });
    await insertSite(db, 's1');
    const migrations = [fill(() => true)];
    const report = await syncDatabase(db, dialect, { desired: after, migrations, dryRun: true });
    deepStrictEqual(report, { deletions: [], warnings: [] });
    ok(!(await dialect.listTables(db)).includes('ohne_migrations'));
    const live = await dialect.describeTable(db, 'Site');
    ok(live.columns.every((column) => column.name !== 'autoRedirect'));
    await syncDatabase(db, dialect, { desired: after, migrations });
    strictEqual((await stamps(db)).length, 1);
    await db.close();
  });
});

describe('syncProjectDatabase with a fill migration', () => {
  usePrinter().configure({ stream: { write: () => true } });

  afterEach(async () => {
    await closeDatabases();
    useEnv().unset('DATABASE');
    useCollections().delete('FillSite');
    useMigrations().delete('app/2026-10-auto-redirect');
  });

  it('skips on a fresh database, the seed then creating the record from the default', async () => {
    useEnv().set('DATABASE', memoryURL);
    useCollections().register('FillSite', {
      name: 'FillSite',
      collection: {
        singleton: true,
        fields: { autoRedirect: field('boolean', { default: true }) },
      },
    } as never);
    useMigrations().register(
      'app/2026-10-auto-redirect',
      meta('app/2026-10-auto-redirect', {
        from: null,
        to: { collection: 'FillSite', field: 'autoRedirect' },
        transform: () => false,
      }),
    );
    await syncProjectDatabase();
    deepStrictEqual(await stamps(useDatabase()), [
      Object.assign(Object.create(null), {
        name: 'app/2026-10-auto-redirect',
        status: 'skipped',
        reason: '`FillSite` holds no rows to fill',
      }),
    ]);
    deepStrictEqual(await queryUntyped('FillSite').select('autoRedirect').findMany(), [
      { autoRedirect: true },
    ]);
  });
});
