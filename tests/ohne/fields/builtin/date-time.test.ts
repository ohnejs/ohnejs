import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { dateTime } from '../../../../src/ohne/fields/builtin/date-time.ts';
import { resolveFieldOptions } from '../../../../src/ohne/fields/field.ts';

type Ctx = Parameters<NonNullable<typeof dateTime.validators>[number]>[1];

const ctx = (options: Record<string, unknown> = {}) => ({ options, errors: {} }) as unknown as Ctx;

const bounds = dateTime.validators![0];

describe('dateTime bounds', () => {
  it('rejects an instant before a numeric `min`', () => {
    deepStrictEqual(bounds(500, ctx({ min: 1000 })), {
      key: 'validation.minValue',
      params: { min: 1000 },
    });
  });

  it('rejects an instant after a numeric `max`', () => {
    deepStrictEqual(bounds(2500, ctx({ max: 2000 })), {
      key: 'validation.maxValue',
      params: { max: 2000 },
    });
  });

  it('rejects an instant before an ISO-string `min`', () => {
    const min = '2024-01-01T00:00:00Z';
    deepStrictEqual(bounds(Date.parse('2023-12-31T23:59:59Z'), ctx({ min })), {
      key: 'validation.minValue',
      params: { min },
    });
  });

  it('rejects an instant after an ISO-string `max`', () => {
    const max = '2024-12-31T00:00:00Z';
    deepStrictEqual(bounds(Date.parse('2025-01-01T00:00:00Z'), ctx({ max })), {
      key: 'validation.maxValue',
      params: { max },
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
