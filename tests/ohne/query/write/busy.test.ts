import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { busyError, isBusyError } from '../../../../src/ohne/query/write/busy.ts';

describe('busyError', () => {
  it('keeps the driver error as its cause', () => {
    const cause = new Error('SQLITE_BUSY');
    strictEqual(busyError(cause).cause, cause);
  });

  it('is named `BusyError`', () => {
    strictEqual(busyError().name, 'BusyError');
  });

  it('is recognized by its guard, and a plain error is not', () => {
    strictEqual(isBusyError(busyError()), true);
    strictEqual(isBusyError(new Error('nope')), false);
    strictEqual(isBusyError(undefined), false);
  });
});
