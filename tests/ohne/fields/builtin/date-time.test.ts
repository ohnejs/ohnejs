import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { dateTime } from '../../../../src/ohne/fields/builtin/date-time.ts';
import { resolveFieldOptions } from '../../../../src/ohne/fields/field.ts';

type Ctx = Parameters<NonNullable<typeof dateTime.validators>[number]>[1];

const ctx = (options: Record<string, unknown> = {}) => ({ options, errors: {} }) as unknown as Ctx;

const bounds = dateTime.validators![0];

describe('dateTime bounds', () => {
  it('rejects an instant before a numeric `min`, naming it as a UTC ISO instant', () => {
    deepStrictEqual(bounds(500, ctx({ min: 1000 })), {
      key: 'validation.minValue',
      params: { min: '1970-01-01T00:00:01.000Z' },
    });
  });

  it('rejects an instant after a numeric `max`, naming it as a UTC ISO instant', () => {
    deepStrictEqual(bounds(2500, ctx({ max: 2000 })), {
      key: 'validation.maxValue',
      params: { max: '1970-01-01T00:00:02.000Z' },
    });
  });

  it('rejects an instant before an ISO-string `min`, naming it in UTC', () => {
    const min = '2024-01-01T01:00:00+01:00';
    deepStrictEqual(bounds(Date.parse('2023-12-31T23:59:59Z'), ctx({ min })), {
      key: 'validation.minValue',
      params: { min: '2024-01-01T00:00:00.000Z' },
    });
  });

  it('rejects an instant after an ISO-string `max`', () => {
    const max = '2024-12-31T00:00:00Z';
    deepStrictEqual(bounds(Date.parse('2025-01-01T00:00:00Z'), ctx({ max })), {
      key: 'validation.maxValue',
      params: { max: '2024-12-31T00:00:00.000Z' },
    });
  });

  it('accepts an instant within bounds', () => {
    strictEqual(bounds(1500, ctx({ min: 1000, max: 2000 })), undefined);
    strictEqual(
      bounds(
        Date.parse('2024-06-01T00:00:00Z'),
        ctx({ min: '2024-01-01T00:00:00Z', max: '2024-12-31T00:00:00Z' }),
      ),
      undefined,
    );
    strictEqual(bounds(1000, ctx({ min: 1000 })), undefined);
    strictEqual(bounds(0, ctx()), undefined);
  });
});

describe('dateTime resolved options', () => {
  it('resolves `relativeTime` to its default and leaves `timezone` absent', () => {
    const resolved = resolveFieldOptions(dateTime, {});
    strictEqual(resolved.relativeTime, false);
    strictEqual('timezone' in resolved, false);
  });

  it('keeps a passed `relativeTime` and `timezone`', () => {
    const resolved = resolveFieldOptions(dateTime, {
      relativeTime: true,
      timezone: 'Europe/Berlin',
    });
    strictEqual(resolved.relativeTime, true);
    strictEqual(resolved.timezone, 'Europe/Berlin');
  });
});

describe('dateTime options', () => {
  type OptionsCtx = Parameters<NonNullable<typeof dateTime.validateOptions>>[0];
  const check = (options: Record<string, unknown>) =>
    dateTime.validateOptions!({ name: 'at', options } as unknown as OptionsCtx);

  it('takes a bound as epoch milliseconds or an ISO 8601 string, and nothing looser', () => {
    strictEqual(check({ min: 0, max: '2030-01-01T00:00:00Z' }), undefined);
    for (const min of ['1', 'March 7, 2024']) {
      strictEqual(check({ min })?.[0], `\`min\` is \`${min}\`, which the field cannot read.`);
    }
  });
});
