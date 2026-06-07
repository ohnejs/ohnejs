import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { coerceToBoolean } from '../../../src/utils/index.ts';

describe('coerceToBoolean', () => {
  it('coerces 1 / 0', () => {
    strictEqual(coerceToBoolean(1), true);
    strictEqual(coerceToBoolean(0), false);
  });

  it('coerces "true" / "false" case-insensitively', () => {
    strictEqual(coerceToBoolean('true'), true);
    strictEqual(coerceToBoolean('TRUE'), true);
    strictEqual(coerceToBoolean('True'), true);
    strictEqual(coerceToBoolean('false'), false);
    strictEqual(coerceToBoolean('FALSE'), false);
    strictEqual(coerceToBoolean('False'), false);
  });

  it('coerces "1" / "0"', () => {
    strictEqual(coerceToBoolean('1'), true);
    strictEqual(coerceToBoolean('0'), false);
  });

  it('returns booleans unchanged', () => {
    strictEqual(coerceToBoolean(true), true);
    strictEqual(coerceToBoolean(false), false);
  });

  it('returns other numbers unchanged', () => {
    strictEqual(coerceToBoolean(2), 2);
    strictEqual(coerceToBoolean(-1), -1);
    strictEqual(coerceToBoolean(1.5), 1.5);
  });

  it('returns other strings unchanged', () => {
    strictEqual(coerceToBoolean('yes'), 'yes');
    strictEqual(coerceToBoolean(''), '');
    strictEqual(coerceToBoolean('truthy'), 'truthy');
  });

  it('returns null, undefined, objects unchanged', () => {
    strictEqual(coerceToBoolean(null), null);
    strictEqual(coerceToBoolean(undefined), undefined);
    const obj = { a: 1 };
    strictEqual(coerceToBoolean(obj), obj);
  });
});
