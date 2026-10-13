import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { boundsProblem } from '../../../src/ohne/fields/bounds.ts';
import { dateTime } from '../../../src/ohne/fields/builtin/date-time.ts';
import { date } from '../../../src/ohne/fields/builtin/date.ts';
import { integer } from '../../../src/ohne/fields/builtin/integer.ts';
import { multiSelect } from '../../../src/ohne/fields/builtin/multi-select.ts';
import { number } from '../../../src/ohne/fields/builtin/number.ts';
import { records } from '../../../src/ohne/fields/builtin/records.ts';
import { repeater } from '../../../src/ohne/fields/builtin/repeater.ts';
import { richText } from '../../../src/ohne/fields/builtin/rich-text.ts';
import { text } from '../../../src/ohne/fields/builtin/text.ts';
import { time } from '../../../src/ohne/fields/builtin/time.ts';

describe('boundsProblem', () => {
  it('accepts absent, one-sided, ordered and equal bounds', () => {
    strictEqual(boundsProblem({}), undefined);
    strictEqual(boundsProblem({ min: 3 }), undefined);
    strictEqual(boundsProblem({ max: 3 }), undefined);
    strictEqual(boundsProblem({ min: 1, max: 10 }), undefined);
    strictEqual(boundsProblem({ min: 6, max: 6 }), undefined);
  });

  it('rejects a lower bound above the upper one, naming both', () => {
    deepStrictEqual(boundsProblem({ min: 10, max: 1 }), [
      '`min` is `10`, above `max` `1`, so no value can pass.',
      'Swap them, or lower `min`.',
    ]);
  });

  it('rejects a bound it cannot read, the lower one first', () => {
    deepStrictEqual(boundsProblem({ min: Number.NaN, max: 'x' }), [
      '`min` is `NaN`, which the field cannot read.',
      'Write it as a number.',
    ]);
    deepStrictEqual(boundsProblem({ max: '5' }), [
      '`max` is `5`, which the field cannot read.',
      'Write it as a number.',
    ]);
  });

  it('reads the pair its rule names, through its `parse`', () => {
    const rule = {
      names: ['from', 'to'] as const,
      parse: (bound: unknown) => (bound === 'low' ? 1 : bound === 'high' ? 2 : undefined),
      form: '`low` or `high`',
    };
    strictEqual(boundsProblem({ from: 'low', to: 'high' }, rule), undefined);
    deepStrictEqual(boundsProblem({ from: 'high', to: 'low' }, rule), [
      '`from` is `high`, above `to` `low`, so no value can pass.',
      'Swap them, or lower `from`.',
    ]);
    deepStrictEqual(boundsProblem({ from: 'mid' }, rule), [
      '`from` is `mid`, which the field cannot read.',
      'Write it as `low` or `high`.',
    ]);
  });
});

describe('bounded built-in types', () => {
  const check = (type: { validateOptions?: (ctx: never) => unknown }, options: object) =>
    type.validateOptions!({ name: 'field', options } as never) as string[] | undefined;

  it('reject inverted bounds and accept equal ones', () => {
    for (const type of [number, integer, text, richText, repeater, records, multiSelect]) {
      ok(check(type, { min: 10, max: 1 }));
      strictEqual(check(type, { min: 6, max: 6 }), undefined);
    }
  });

  it('read `date` bounds as calendar days', () => {
    strictEqual(check(date, { min: '2026-01-01', max: '2026-12-31' }), undefined);
    ok(check(date, { min: '2026-12-31', max: '2026-01-01' }));
    deepStrictEqual(check(date, { min: '2026-13-01' }), [
      '`min` is `2026-13-01`, which the field cannot read.',
      'Write it as `YYYY-MM-DD`.',
    ]);
  });

  it('read `time` bounds at full width, so `09:00` equals `09:00:00`', () => {
    strictEqual(check(time, { min: '09:00:00', max: '09:00' }), undefined);
    ok(check(time, { min: '18:00', max: '09:00' }));
    ok(check(time, { max: '25:00' }));
  });

  it('read `dateTime` bounds as instants, in either form', () => {
    strictEqual(check(dateTime, { min: 0, max: '2027-01-01' }), undefined);
    ok(check(dateTime, { min: '2027-01-01', max: 0 }));
    deepStrictEqual(check(dateTime, { min: 'nope' }), [
      '`min` is `nope`, which the field cannot read.',
      'Write it as epoch milliseconds or an ISO 8601 string.',
    ]);
  });

  it('reject a `multiSelect` `min` above its choices', () => {
    deepStrictEqual(check(multiSelect, { choices: ['a', 'b'], min: 3 }), [
      '`min` is `3`, above the `2` choices, so no list can hold enough.',
      'Lower `min`, or add choices.',
    ]);
    strictEqual(check(multiSelect, { choices: ['a', 'b'], min: 2 }), undefined);
  });
});
