import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { DashboardField } from '../../../src/dashboard/runtime/meta-types.ts';

import {
  parseIntegerValue,
  parseRealValue,
  parseTextValue,
} from '../../../src/dashboard/fields/parse.ts';

function field(over: Partial<DashboardField> = {}): DashboardField {
  return {
    name: 'value',
    type: 'text',
    kind: 'column',
    logicalType: 'text',
    label: 'Value',
    nullable: false,
    required: false,
    unique: false,
    translatable: false,
    readable: true,
    writable: true,
    immutable: false,
    ...over,
  };
}

describe('parseTextValue', () => {
  it('keeps a non-empty string as typed', () => {
    strictEqual(parseTextValue(field(), '  spaced  '), '  spaced  ');
  });

  it('resolves an emptied nullable field to null', () => {
    strictEqual(parseTextValue(field({ nullable: true }), ''), null);
  });

  it('keeps the empty string on a non-nullable field', () => {
    strictEqual(parseTextValue(field(), ''), '');
  });
});

describe('parseIntegerValue', () => {
  it('parses a whole number', () => {
    deepStrictEqual(parseIntegerValue(field(), '42'), { value: 42 });
  });

  it('trims around the digits', () => {
    deepStrictEqual(parseIntegerValue(field(), ' 7 '), { value: 7 });
  });

  it('rejects a float', () => {
    deepStrictEqual(parseIntegerValue(field(), '4.2'), { error: 'dashboard.invalidInteger' });
  });

  it('rejects a non-number', () => {
    deepStrictEqual(parseIntegerValue(field(), '4x'), { error: 'dashboard.invalidInteger' });
  });

  it('resolves an emptied nullable field to null', () => {
    deepStrictEqual(parseIntegerValue(field({ nullable: true }), ''), { value: null });
  });

  it('omits an emptied non-nullable field', () => {
    deepStrictEqual(parseIntegerValue(field(), ''), {});
  });
});

describe('parseRealValue', () => {
  it('parses a decimal', () => {
    deepStrictEqual(parseRealValue(field(), '4.25'), { value: 4.25 });
  });

  it('rejects a non-number', () => {
    deepStrictEqual(parseRealValue(field(), '1e5x'), { error: 'dashboard.invalidNumber' });
  });

  it('resolves an emptied nullable field to null', () => {
    deepStrictEqual(parseRealValue(field({ nullable: true }), ''), { value: null });
  });

  it('omits an emptied non-nullable field', () => {
    deepStrictEqual(parseRealValue(field(), ''), {});
  });
});
