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
import { queryUntyped } from '../../../../src/ohne/query/query.ts';
import { isValidationError } from '../../../../src/ohne/query/write/errors.ts';
import { createRegistry } from '../../../../src/utils/index.ts';
import { connectTest, dialect } from '../../../_dialect.ts';

type OptionsCtx = Parameters<NonNullable<typeof range.validateOptions>>[0];
type SchemaCtx = Parameters<NonNullable<typeof range.schema>>[0];

const checkOptions = (options: Record<string, unknown>) =>
  range.validateOptions!({
    name: 'window',
    options: { open: false, ...options },
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

const db = await connectTest();
registerDialect(dialect);
registerDatabase(db);
await syncDatabase(db, dialect, {
  desired: buildDesiredSchema(useCollections(), useFields() as never),
});

const sieges = () => queryUntyped('Sieges');
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
        'Use `date`, `dateTime` or `time`.',
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
