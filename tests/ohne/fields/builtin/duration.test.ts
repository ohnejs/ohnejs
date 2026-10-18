import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { FieldSearchContext } from '../../../../src/ohne/fields/define-field.ts';

import { useCollections } from '../../../../src/ohne/collections/use-collections.ts';
import { buildDesiredSchema } from '../../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../../src/ohne/database/schema/sync.ts';
import { registerDatabase, registerDialect } from '../../../../src/ohne/database/use-database.ts';
import { duration } from '../../../../src/ohne/fields/builtin/duration.ts';
import { searchHook } from '../../../../src/ohne/fields/field-search.ts';
import { field, resolveFieldOptions } from '../../../../src/ohne/fields/field.ts';
import { useFields } from '../../../../src/ohne/fields/use-fields.ts';
import * as ohne from '../../../../src/ohne/index.ts';
import { queryUntyped } from '../../../../src/ohne/query/query.ts';
import { isValidationError } from '../../../../src/ohne/query/write/errors.ts';
import { connectTest, dialect } from '../../../_dialect.ts';

type OptionsCtx = Parameters<NonNullable<typeof duration.validateOptions>>[0];

const checkOptions = (options: Record<string, unknown>) =>
  duration.validateOptions!({
    name: 'cooldown',
    options: { min: 0, ...options },
  } as unknown as OptionsCtx);

useCollections().register('Spells', {
  name: 'Spells',
  collection: {
    fields: {
      name: field('text'),
      cooldown: field('duration', { max: '2h', unique: true }),
    },
  },
});

const db = await connectTest();
registerDialect(dialect);
registerDatabase(db);
await syncDatabase(db, dialect, {
  desired: buildDesiredSchema(useCollections(), useFields() as never),
});

describe('duration writes', () => {
  it('stores whole milliseconds', async () => {
    const spell = await queryUntyped('Spells').createOrThrow({
      name: 'Hearthstone',
      cooldown: 1_800_000,
    });
    strictEqual(spell.cooldown, 1_800_000);
  });

  it('refuses a negative through the default `min`', async () => {
    await rejects(
      queryUntyped('Spells').createOrThrow({ name: 'Rewind', cooldown: -1 }),
      (error) => {
        ok(isValidationError(error));
        deepStrictEqual(error.errors.cooldown, {
          key: 'validation.minValue',
          params: { min: '0ms' },
        });
        return true;
      },
    );
  });

  it('names the failing bound in canonical text', async () => {
    await rejects(
      queryUntyped('Spells').createOrThrow({ name: 'Bloodlust', cooldown: 7_200_001 }),
      (error) => {
        ok(isValidationError(error));
        deepStrictEqual(error.errors.cooldown, {
          key: 'validation.maxValue',
          params: { max: '2h' },
        });
        return true;
      },
    );
  });

  it('refuses text, since writes carry milliseconds', async () => {
    await rejects(
      queryUntyped('Spells').createOrThrow({ name: 'Blink', cooldown: '15s' }),
      (error) => isValidationError(error) && error.errors.cooldown === 'validation.invalidValue',
    );
  });

  it('keeps `unique`', async () => {
    await rejects(
      queryUntyped('Spells').createOrThrow({ name: 'Recall', cooldown: 1_800_000 }),
      (error) => isValidationError(error) && error.errors.cooldown === 'validation.notUnique',
    );
  });
});

describe('duration options', () => {
  it('defaults `min` to 0', () => {
    strictEqual(resolveFieldOptions(duration, {}).min, 0);
  });

  it('accepts bounds as milliseconds or text', () => {
    strictEqual(checkOptions({ min: '5m', max: 3_600_000 }), undefined);
  });

  it('refuses a bound that is no duration', () => {
    deepStrictEqual(checkOptions({ max: '2 Stunden' }), [
      '`max` is `2 Stunden`, which is no duration.',
      "Write it as whole milliseconds or as text like `'1h 30m'`.",
    ]);
    ok(checkOptions({ min: -5 })?.[0]?.startsWith('`min` is `-5`'));
  });

  it('refuses `min` above `max`', () => {
    deepStrictEqual(checkOptions({ min: '2h', max: '1h' }), [
      '`min` is `2h`, above `max` `1h`, so no value can pass.',
      'Swap them, or lower `min`.',
    ]);
  });
});

describe('duration search', () => {
  const search = (token: string) =>
    searchHook(duration)!({
      name: 'cooldown',
      options: {},
      token,
    } as unknown as FieldSearchContext);

  it('matches a duration token, and nothing else', () => {
    deepStrictEqual(search('90m'), { equalsTo: 5_400_000 });
    strictEqual(search('90'), null);
  });

  it('is exported from `ohnejs`', () => {
    ok(ohne.duration === duration);
  });
});
