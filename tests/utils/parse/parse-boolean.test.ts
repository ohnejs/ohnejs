import { strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { parseBoolean } from '../../../src/utils/index.ts';

describe('parseBoolean', () => {
  it('returns booleans unchanged', () => {
    strictEqual(parseBoolean(true), true);
    strictEqual(parseBoolean(false), false);
  });

  it('accepts numeric 1 / 0', () => {
    strictEqual(parseBoolean(1), true);
    strictEqual(parseBoolean(0), false);
  });

  it('parses case-insensitive "true" / "false"', () => {
    strictEqual(parseBoolean('true'), true);
    strictEqual(parseBoolean('TRUE'), true);
    strictEqual(parseBoolean('True'), true);
    strictEqual(parseBoolean('false'), false);
    strictEqual(parseBoolean('FALSE'), false);
  });

  it('parses "1" / "0"', () => {
    strictEqual(parseBoolean('1'), true);
    strictEqual(parseBoolean('0'), false);
  });

  it('throws on other numbers', () => {
    throws(() => parseBoolean(2), /Expected boolean/);
    throws(() => parseBoolean(-1), /Expected boolean/);
    throws(() => parseBoolean(1.5), /Expected boolean/);
  });

  it('throws on other strings', () => {
    throws(() => parseBoolean('yes'), /Expected boolean/);
    throws(() => parseBoolean(''), /Expected boolean/);
    throws(() => parseBoolean('truthy'), /Expected boolean/);
  });

  it('throws on null, undefined, objects', () => {
    throws(() => parseBoolean(null), /Expected boolean/);
    throws(() => parseBoolean(undefined), /Expected boolean/);
    throws(() => parseBoolean({}), /Expected boolean/);
  });

  it('throws a descriptive error on bigints', () => {
    throws(() => parseBoolean(1n), /Expected boolean/);
  });
});
