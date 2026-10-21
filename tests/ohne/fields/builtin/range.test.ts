import { deepStrictEqual, ok, rejects, strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import type { CollectionMeta } from '../../../../src/ohne/collections/use-collections.ts';
import type { FieldInstance } from '../../../../src/ohne/fields/field.ts';
import type { FieldTypeMeta } from '../../../../src/ohne/fields/use-fields.ts';
import type { Registry } from '../../../../src/utils/index.ts';

import { useCollections } from '../../../../src/ohne/collections/use-collections.ts';
import { buildDesiredSchema } from '../../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../../src/ohne/database/schema/sync.ts';
import { registerDatabase, registerDialect } from '../../../../src/ohne/database/use-database.ts';
import { range } from '../../../../src/ohne/fields/builtin/range.ts';
import { field } from '../../../../src/ohne/fields/field.ts';
import { useFields } from '../../../../src/ohne/fields/use-fields.ts';
import * as ohne from '../../../../src/ohne/index.ts';
import { queryMetadata } from '../../../../src/ohne/query/metadata.ts';
import { queryUntyped } from '../../../../src/ohne/query/query.ts';
import { isValidationError } from '../../../../src/ohne/query/write/errors.ts';
import { createRegistry } from '../../../../src/utils/index.ts';
import { connectTest, dialect } from '../../../_dialect.ts';

type OptionsCtx = Parameters<NonNullable<typeof range.validateOptions>>[0];
type SchemaCtx = Parameters<NonNullable<typeof range.schema>>[0];

const checkOptions = (options: Record<string, unknown>) =>
  range.validateOptions!({
    name: 'window',
    options: { open: false, display: 'input', ...options },
  } as unknown as OptionsCtx);

useCollections().register('Sieges', {
  name: 'Sieges',
  collection: {
    fields: {
      name: field('text'),
      window: field('range', { of: 'date', minSpan: '1 day', max: '2030-12-31' }),
      shift: field('range', { of: 'time', nullable: true, maxSpan: '8h' }),
      raid: field('range', { of: 'dateTime', open: true, nullable: true }),
    },
  },
});
useCollections().register('Bounties', {
  name: 'Bounties',
  collection: {
    fields: {
      name: field('text'),
      reward: field('range', {
        of: 'integer',
        currency: 'EUR',
        min: 0,
        max: 500_000,
        minSpan: 1000,
      }),
      weight: field('range', { of: 'number', step: 0.5, min: 0, max: 50, nullable: true }),
      floors: field('range', { of: 'integer', open: true, nullable: true, search: true }),
    },
  },
});

const db = await connectTest();
registerDialect(dialect);
registerDatabase(db);
await syncDatabase(db, dialect, {
  desired: buildDesiredSchema(useCollections(), useFields() as never),
});

const sieges = () => queryUntyped('Sieges');
const bounties = () => queryUntyped('Bounties');
const REWARD = { start: 1000, end: 5000 };
const failsWith = (path: string, key: string) => (error: unknown) =>
  isValidationError(error) && error.errors[path] === key;
const failsWithParams =
  (path: string, key: string, params: Record<string, unknown>) => (error: unknown) => {
    if (!isValidationError(error)) return false;
    deepStrictEqual(error.errors[path], { key, params });
    return true;
  };
const WEEK = { start: '2008-11-13', end: '2008-11-20' };

describe('range', () => {
  it('is a registered core type', () => {
    strictEqual(useFields().get('range')?.fieldType, range);
    strictEqual(ohne.range, range);
  });

  it('stores two ends of its `of` type, each carrying the bounds and the zone', () => {
    const hint = range.schema!({
      options: { of: 'dateTime', min: 0, max: '2030-01-01', open: true, timezone: 'Europe/Berlin' },
    } as unknown as SchemaCtx);
    deepStrictEqual(hint, {
      kind: 'child',
      cardinality: 'one',
      orderBy: 'start',
      subfields: {
        start: field('dateTime', {
          min: 0,
          max: '2030-01-01',
          timezone: 'Europe/Berlin',
          nullable: false,
          label: 'dashboard.range.start',
        }),
        end: field('dateTime', {
          min: 0,
          max: '2030-01-01',
          timezone: 'Europe/Berlin',
          nullable: true,
          label: 'dashboard.range.end',
        }),
      },
    });
  });

  it('reads back `{ UUID, start, end }` in each kind’s stored form', async () => {
    const siege = await sieges().createOrThrow({
      name: 'Wrathgate',
      window: WEEK,
      shift: { start: '09:30', end: '17:00:00' },
      raid: { start: '1000', end: 2000 },
    });
    const window = siege.window as Record<string, unknown>;
    ok(typeof window.UUID === 'string');
    deepStrictEqual({ start: window.start, end: window.end }, WEEK);
    deepStrictEqual(
      { ...(siege.shift as object), UUID: undefined },
      { UUID: undefined, start: '09:30:00', end: '17:00:00' },
    );
    deepStrictEqual(
      { ...(siege.raid as object), UUID: undefined },
      { UUID: undefined, start: 1000, end: 2000 },
    );
  });

  it('is required unless `nullable`, and refuses a partial write', async () => {
    await rejects(
      sieges().createOrThrow({ name: 'Angrathar' }),
      failsWith('window', 'validation.required'),
    );
    await rejects(
      sieges().createOrThrow({ name: 'Angrathar', window: null }),
      failsWith('window', 'validation.notNullable'),
    );
    await rejects(
      sieges().createOrThrow({ name: 'Angrathar', window: { end: '2008-11-20' } }),
      failsWith('window.start', 'validation.required'),
    );
    const siege = await sieges().createOrThrow({ name: 'Angrathar', window: WEEK, shift: null });
    strictEqual(siege.shift, null);
    strictEqual(siege.raid, null);
  });

  it('refuses a start after its end, comparing what each end stores', async () => {
    await rejects(
      sieges().createOrThrow({
        name: 'Icecrown',
        window: { start: '2008-11-20', end: '2008-11-13' },
      }),
      failsWith('window', 'validation.invalidRange'),
    );
    await rejects(
      sieges().createOrThrow({
        name: 'Icecrown',
        window: WEEK,
        raid: { start: '2000', end: '1000' },
      }),
      failsWith('raid', 'validation.invalidRange'),
    );
    const mixed = await sieges().createOrThrow({
      name: 'Icecrown',
      window: WEEK,
      shift: { start: '09:30:00', end: '09:30' },
    });
    strictEqual((mixed.shift as { end: string }).end, '09:30:00');
  });

  it('checks the span: whole days for a date, real milliseconds for a time', async () => {
    await rejects(
      sieges().createOrThrow({
        name: 'Naxxramas',
        window: { start: '2008-11-13', end: '2008-11-13' },
      }),
      failsWithParams('window', 'validation.minSpan', { min: '1d' }),
    );
    await rejects(
      sieges().createOrThrow({
        name: 'Naxxramas',
        window: WEEK,
        shift: { start: '08:00', end: '16:00:01' },
      }),
      failsWithParams('shift', 'validation.maxSpan', { max: '8h' }),
    );
    const across = await sieges().createOrThrow({
      name: 'Naxxramas',
      window: { start: '2024-03-30', end: '2024-03-31' },
    });
    strictEqual((across.window as { end: string }).end, '2024-03-31');
  });

  it('leaves a malformed end to its own error, and skips the span of an open end', async () => {
    await rejects(
      sieges().createOrThrow({
        name: 'Ulduar',
        window: { start: '2008-02-30', end: '2008-11-20' },
      }),
      (error: unknown) =>
        isValidationError(error) &&
        error.errors['window.start'] === 'validation.invalidDate' &&
        !('window' in error.errors),
    );
    const open = await sieges().createOrThrow({
      name: 'Ulduar',
      window: WEEK,
      raid: { start: 5000, end: null },
    });
    strictEqual((open.raid as { end: unknown }).end, null);
  });

  it('holds each end to the range’s bounds', async () => {
    await rejects(
      sieges().createOrThrow({
        name: 'Onyxia',
        window: { start: '2030-12-30', end: '2031-01-02' },
      }),
      failsWithParams('window.end', 'validation.maxValue', { max: '2030-12-31' }),
    );
  });

  it('filters through `has` and sorts by its start', async () => {
    const overlapping = await sieges()
      .where({
        name: 'Wrathgate',
        window: { has: { start: { atMost: '2008-11-15' }, end: { atLeast: '2008-11-14' } } },
      })
      .findMany();
    strictEqual(overlapping.length, 1);
    const starts = async (direction: 'asc' | 'desc') =>
      (
        await sieges()
          .where({ raid: { has: {} } })
          .orderBy('raid', direction)
          .findMany()
      ).map((siege) => (siege.raid as { start: number }).start);
    deepStrictEqual(await starts('asc'), [1000, 5000]);
    deepStrictEqual(await starts('desc'), [5000, 1000]);
  });

  it('builds numeric ends carrying the grid, unit, currency and search, never the slider', () => {
    const hint = range.schema!({
      options: {
        of: 'integer',
        min: 0,
        max: 100,
        step: 5,
        currency: 'EUR',
        display: 'slider',
        open: false,
        search: true,
      },
    } as unknown as SchemaCtx) as { subfields: Record<string, FieldInstance> };
    deepStrictEqual(
      hint.subfields.start,
      field('integer', {
        min: 0,
        max: 100,
        step: 5,
        currency: 'EUR',
        suffix: undefined,
        search: true,
        nullable: false,
        label: 'dashboard.range.start',
      }),
    );
    const number = range.schema!({
      options: { of: 'number', suffix: 'kg', display: 'input', open: true },
    } as unknown as SchemaCtx) as { subfields: Record<string, FieldInstance> };
    deepStrictEqual(number.subfields.end?.options, {
      min: undefined,
      max: undefined,
      step: undefined,
      suffix: 'kg',
      search: undefined,
      nullable: true,
      label: 'dashboard.range.end',
    });
  });

  it('stores numeric ends, coercing a numeric string as the column does', async () => {
    const bounty = await bounties().createOrThrow({
      name: 'Hogger',
      reward: { start: '2000', end: 9000 },
      weight: { start: 0.5, end: 12.5 },
      floors: { start: 3, end: null },
    });
    const ends = (value: unknown) => {
      const { start, end } = value as { start: unknown; end: unknown };
      return { start, end };
    };
    deepStrictEqual(ends(bounty.reward), { start: 2000, end: 9000 });
    deepStrictEqual(ends(bounty.weight), { start: 0.5, end: 12.5 });
    deepStrictEqual(ends(bounty.floors), { start: 3, end: null });
  });

  it('checks a numeric span, naming a currency bound as an amount', async () => {
    await rejects(
      bounties().createOrThrow({ name: 'VanCleef', reward: { start: 5000, end: 5999 } }),
      failsWithParams('reward', 'validation.minSpan', { min: { minor: 1000, currency: 'EUR' } }),
    );
    await rejects(
      bounties().createOrThrow({ name: 'VanCleef', reward: { start: 5000, end: 1000 } }),
      failsWith('reward', 'validation.invalidRange'),
    );
    await rejects(
      bounties().createOrThrow({ name: 'VanCleef', reward: REWARD, floors: { start: 2, end: 1 } }),
      failsWith('floors', 'validation.invalidRange'),
    );
  });

  it('holds each numeric end to its bounds and grid', async () => {
    await rejects(
      bounties().createOrThrow({ name: 'Edwin', reward: { start: 1000, end: 600_000 } }),
      failsWithParams('reward.end', 'validation.maxValue', {
        max: { minor: 500000, currency: 'EUR' },
      }),
    );
    await rejects(
      bounties().createOrThrow({ name: 'Edwin', reward: REWARD, weight: { start: 0.25, end: 1 } }),
      failsWithParams('weight.start', 'validation.invalidStep', { step: 0.5 }),
    );
    await rejects(
      bounties().createOrThrow({ name: 'Edwin', reward: { start: 1.5, end: 5000 } }),
      (error: unknown) =>
        isValidationError(error) && 'reward.start' in error.errors && !('reward' in error.errors),
    );
  });

  it('filters numeric ends through `has`, sorts by the start, and searches them on `search: true`', async () => {
    await bounties().createOrThrow({ name: 'Mor', reward: REWARD, floors: { start: 42, end: 50 } });
    const named = async (where: Record<string, unknown>) =>
      (await bounties().where(where).orderBy('floors', 'desc').findMany()).map((b) => b.name);
    deepStrictEqual(await named({ floors: { has: { start: { atLeast: 1 } } } }), ['Mor', 'Hogger']);
    const search = (name: string) => {
      const ends = queryMetadata('Bounties').fields[name]?.subfields;
      return [ends?.start?.search, ends?.end?.search];
    };
    deepStrictEqual(search('floors'), [true, true]);
    deepStrictEqual(search('weight'), [undefined, undefined]);
  });

  it('builds its ends from registered types even for a bad `of`, so codegen never names it a type', () => {
    const hint = range.schema!({
      options: { of: 'week', open: false },
    } as unknown as SchemaCtx) as {
      subfields: Record<string, FieldInstance>;
    };
    for (const end of Object.values(hint.subfields)) ok(useFields().has(end.type), end.type);
  });

  it('names a bad `of` at boot, never an unknown field type', () => {
    const collections = createRegistry<CollectionMeta>();
    collections.register('Weeks', {
      name: 'Weeks',
      collection: { fields: { span: field('range', { of: 'week' as never }) } },
    });
    throws(
      () => buildDesiredSchema(collections, useFields() as Registry<FieldTypeMeta>),
      (error: Error & { body?: string[] }) => /`of` is `week`/.test(String(error.body)),
    );
  });

  describe('options', () => {
    it('refuses an unknown kind', () => {
      deepStrictEqual(checkOptions({ of: 'week' }), [
        '`of` is `week`, which is no range kind.',
        'Use `date`, `dateTime`, `time`, `integer` or `number`.',
      ]);
    });

    it('refuses a span bound it cannot read, or one above the other', () => {
      deepStrictEqual(checkOptions({ of: 'date', minSpan: 'soon' }), [
        '`minSpan` is `soon`, which the field cannot read.',
        "Write it as whole milliseconds or text like `'1 day'`.",
      ]);
      deepStrictEqual(checkOptions({ of: 'time', minSpan: '2h', maxSpan: '1h' }), [
        '`minSpan` is `2h`, above `maxSpan` `1h`, so no value can pass.',
        'Swap them, or lower `minSpan`.',
      ]);
    });

    it('holds a date span to whole days', () => {
      deepStrictEqual(checkOptions({ of: 'date', maxSpan: '36h' }), [
        '`maxSpan` is `1d 12h`, but a `date` range spans whole days.',
        "Write it in days, like `'1d'`.",
      ]);
      strictEqual(checkOptions({ of: 'date', minSpan: '1 week' }), undefined);
    });

    it('refuses `open` on a time range or beside `maxSpan`', () => {
      deepStrictEqual(checkOptions({ of: 'time', open: true }), [
        'A `time` range cannot be `open`: it starts and ends on the same day.',
        'Drop `open`.',
      ]);
      deepStrictEqual(checkOptions({ of: 'date', open: true, maxSpan: '7d' }), [
        'An `open` range can leave its end out, so `maxSpan` could never hold.',
        'Drop `open` or `maxSpan`.',
      ]);
      strictEqual(checkOptions({ of: 'date', open: true, minSpan: '1d' }), undefined);
    });

    it('takes the numeric options on a numeric range only', () => {
      deepStrictEqual(checkOptions({ of: 'date', step: 1 }), [
        '`step` applies to an `integer` or `number` range only, and this one is `date`.',
        'Drop `step`.',
      ]);
      deepStrictEqual(checkOptions({ of: 'time', display: 'slider' }), [
        "`display: 'slider'` applies to an `integer` or `number` range only, and this one is `time`.",
        "Drop `display: 'slider'`.",
      ]);
      deepStrictEqual(checkOptions({ of: 'number', currency: 'EUR' }), [
        '`currency` applies to an `integer` range only, and this one is `number`.',
        'Drop `currency`.',
      ]);
      strictEqual(checkOptions({ of: 'number', suffix: 'kg', step: 0.5 }), undefined);
    });

    it('refuses a `minSpan` no range between its bounds can reach', () => {
      deepStrictEqual(checkOptions({ of: 'time', minSpan: '2d' }), [
        '`minSpan` is `2d`, wider than any range from `00:00:00` to `23:59:59`, so no range can pass.',
        'Lower `minSpan` below a day: a `time` range starts and ends on the same day.',
      ]);
      deepStrictEqual(
        checkOptions({ of: 'date', min: '2030-01-01', max: '2030-01-04', minSpan: '1 week' }),
        [
          '`minSpan` is `7d`, wider than any range from `2030-01-01` to `2030-01-04`, so no range can pass.',
          'Lower `minSpan`, or widen `min` and `max`.',
        ],
      );
      strictEqual(
        checkOptions({ of: 'dateTime', min: 0, max: 3_600_000, minSpan: '2h' })?.[0],
        '`minSpan` is `2h`, wider than any range from `0` to `3600000`, so no range can pass.',
      );
      strictEqual(
        checkOptions({ of: 'integer', min: 0, max: 10, minSpan: 20 })?.[0],
        '`minSpan` is `20`, wider than any range from `0` to `10`, so no range can pass.',
      );
      strictEqual(
        checkOptions({ of: 'integer', min: 0, max: 10, step: 3, minSpan: 10 })?.[0],
        '`minSpan` is `10`, wider than any range from `0` to `9`, so no range can pass.',
      );
      strictEqual(checkOptions({ of: 'time', minSpan: '23h 59m 59s' }), undefined);
      strictEqual(checkOptions({ of: 'number', min: 0.1, max: 0.3, minSpan: 0.2 }), undefined);
      strictEqual(checkOptions({ of: 'dateTime', min: 0, minSpan: '1 week' }), undefined);
      strictEqual(
        checkOptions({ of: 'date', min: '2030-01-01', max: '2030-01-08', minSpan: '1 week' }),
        undefined,
      );
    });

    it('takes a numeric span at or above `0`, whole on an `integer` range', () => {
      deepStrictEqual(checkOptions({ of: 'number', minSpan: '1 day' }), [
        '`minSpan` is `1 day`, which the field cannot read.',
        'Write it as a number at or above `0`.',
      ]);
      deepStrictEqual(checkOptions({ of: 'number', minSpan: 5, maxSpan: 2 }), [
        '`minSpan` is `5`, above `maxSpan` `2`, so no value can pass.',
        'Swap them, or lower `minSpan`.',
      ]);
      deepStrictEqual(checkOptions({ of: 'integer', maxSpan: 2.5 }), [
        '`maxSpan` is `2.5`, but an `integer` range spans whole numbers.',
        'Use a whole `maxSpan`, like `5`.',
      ]);
      strictEqual(
        checkOptions({ of: 'integer', currency: 'EUR', minSpan: 0.5 })?.[1],
        'Write `minSpan` in minor units, like `1999` for 19.99 EUR.',
      );
      strictEqual(
        checkOptions({ of: 'integer', currency: 'KWD', minSpan: 0.5 })?.[1],
        'Write `minSpan` in minor units, like `1999` for 1.999 KWD.',
      );
      strictEqual(
        checkOptions({ of: 'integer', currency: 'XYZ', minSpan: 0.5 })?.[1],
        'Use a whole `minSpan`, like `5`.',
      );
      strictEqual(checkOptions({ of: 'number', minSpan: 0.5, maxSpan: 2 }), undefined);
    });

    it('needs a bounded slider, on a grid on a `number` range', () => {
      deepStrictEqual(checkOptions({ of: 'integer', display: 'slider', min: 0 }), [
        "`display: 'slider'` needs `min` and `max`.",
        'Set the range the slider spans, like `min: 0, max: 10`.',
      ]);
      strictEqual(
        checkOptions({ of: 'number', display: 'slider', min: 0, max: 5 })?.[0],
        "`display: 'slider'` on a `number` range needs `min`, `max` and `step`.",
      );
      strictEqual(
        checkOptions({ of: 'integer', display: 'slider', min: 0.5, max: 9 })?.[0],
        '`min` is `0.5`, so the grid it starts holds no whole number.',
      );
      deepStrictEqual(checkOptions({ of: 'integer', display: 'slider', min: '0', max: 9 }), [
        '`min` is `0`, which the field cannot read.',
        'Write it as a number.',
      ]);
      strictEqual(
        checkOptions({
          of: 'integer',
          currency: 'EUR',
          display: 'slider',
          min: 0,
          max: 10_000,
          step: 500,
        }),
        undefined,
      );
    });

    it('keeps a slider span on its grid', () => {
      deepStrictEqual(
        checkOptions({ of: 'number', display: 'slider', min: 0, max: 5, step: 0.5, minSpan: 0.75 }),
        [
          "`minSpan` is `0.75`, off the slider's `step` of `0.5`.",
          'Use a multiple of `0.5` for `minSpan`.',
        ],
      );
      strictEqual(
        checkOptions({ of: 'integer', display: 'slider', min: 0, max: 9, minSpan: 3, maxSpan: 6 }),
        undefined,
      );
      strictEqual(checkOptions({ of: 'number', step: 0.5, minSpan: 0.75 }), undefined);
    });

    it('takes `open` on a numeric range', () => {
      strictEqual(checkOptions({ of: 'integer', open: true, minSpan: 1 }), undefined);
    });

    it('takes a `timezone` on a `dateTime` range only, and a real one', () => {
      deepStrictEqual(checkOptions({ of: 'date', timezone: 'UTC' }), [
        '`timezone` applies to a `dateTime` range only, and this one is `date`.',
        'Drop `timezone`.',
      ]);
      deepStrictEqual(checkOptions({ of: 'dateTime', timezone: 'Mars/Olympus' }), [
        '`timezone` is `Mars/Olympus`, which is no IANA time zone.',
        'Use a name like `Europe/Berlin`.',
      ]);
      strictEqual(checkOptions({ of: 'dateTime', timezone: 'Europe/Berlin' }), undefined);
    });
  });
});
