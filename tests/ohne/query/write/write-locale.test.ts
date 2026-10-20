import { deepStrictEqual } from 'node:assert';
import { afterEach, describe, it } from 'node:test';

import type { Transaction } from '../../../../src/ohne/database/adapter.ts';

import { useCollections } from '../../../../src/ohne/collections/use-collections.ts';
import { buildDesiredSchema } from '../../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../../src/ohne/database/schema/sync.ts';
import { registerDatabase, registerDialect } from '../../../../src/ohne/database/use-database.ts';
import { field } from '../../../../src/ohne/fields/field.ts';
import { useFields } from '../../../../src/ohne/fields/use-fields.ts';
import { hook } from '../../../../src/ohne/hooks/hook.ts';
import { useHooks } from '../../../../src/ohne/hooks/use-hooks.ts';
import { useLayers } from '../../../../src/ohne/layers/use-layers.ts';
import { queryUntyped } from '../../../../src/ohne/query/query.ts';
import { validateLiteralDefaults } from '../../../../src/ohne/query/validate-literal-defaults.ts';
import { connectTest, dialect } from '../../../_dialect.ts';

useLayers().add({
  path: '/write-locale',
  input: { collections: { locales: ['en', 'de'], defaultLocale: 'en' } },
});

const seen: string[] = [];
const note =
  (what: string) =>
  (value: unknown, ctx: { operation: string; locale: string }): undefined => {
    seen.push(`${what} ${ctx.operation} ${ctx.locale}`);
    return undefined;
  };

useCollections().register('WLPosts', {
  name: 'WLPosts',
  collection: {
    fields: {
      title: field('text', { translatable: true, validators: [note('title')] }),
      summary: field('text', {
        translatable: true,
        default: (ctx: { operation: string; locale: string }) => {
          seen.push(`summary-default ${ctx.operation} ${ctx.locale}`);
          return 'draft';
        },
      }),
      views: field('integer', {
        sanitizers: [
          (value: number, ctx: { operation: string; locale: string }) => {
            note('views')(value, ctx);
            return value;
          },
        ],
      }),
    },
  },
});

const db = await connectTest();
registerDialect(dialect);
registerDatabase(db);
await syncDatabase(db, dialect, {
  desired: buildDesiredSchema(useCollections(), useFields() as never),
});

const take = (): string[] => seen.splice(0).sort();

describe('the write locale', () => {
  afterEach(() => {
    useHooks().clear();
    seen.length = 0;
  });

  it('reaches every field callback and record hook at the locale the write stores', async () => {
    hook('record:before-change', (input, ctx) => {
      seen.push(`before-change ${ctx.operation} ${ctx.locale}`);
      return input;
    });
    hook('record:validate', (errors, _scope, ctx) => {
      seen.push(`validate ${ctx.operation} ${ctx.locale}`);
      return errors;
    });
    const created = await queryUntyped('WLPosts').createOrThrow({ title: 'Hello', views: 1 });
    deepStrictEqual(take(), [
      'before-change create en',
      'summary-default create en',
      'title create en',
      'validate create en',
      'views create en',
    ]);
    await queryUntyped('WLPosts')
      .locale('de')
      .where({ UUID: created.UUID })
      .updateOrThrow({ title: 'Hallo' });
    deepStrictEqual(take(), [
      'before-change update de',
      'summary-default update de',
      'title update de',
      'validate update de',
    ]);
  });

  it('runs a create with `locales` at its own locale, then each fill at the fill locale', async () => {
    await queryUntyped('WLPosts').create(
      { title: 'Hello', views: 1 },
      { locales: { de: { title: 'Hallo' } } },
    );
    deepStrictEqual(take(), [
      'summary-default create en',
      'summary-default update de',
      'title create en',
      'title update de',
      'views create en',
    ]);
  });

  it('runs a duplicate at the source locale, then each held locale at its own', async () => {
    const source = await queryUntyped('WLPosts').createOrThrow(
      { title: 'Hello', views: 1 },
      { locales: { de: { title: 'Hallo' } } },
    );
    take();
    await queryUntyped('WLPosts').duplicate(source.UUID as string);
    deepStrictEqual(
      take().filter((line) => line.startsWith('title')),
      ['title create en', 'title update de'],
    );
  });

  it('checks a literal default at boot in the default locale', async () => {
    useCollections().register('WLDefaults', {
      name: 'WLDefaults',
      collection: {
        fields: { label: field('text', { default: 'x', validators: [note('label')] }) },
      },
    });
    try {
      await validateLiteralDefaults({} as Transaction);
    } finally {
      useCollections().delete('WLDefaults');
    }
    deepStrictEqual(take(), ['label create en']);
  });
});
