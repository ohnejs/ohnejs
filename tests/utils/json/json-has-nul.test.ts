import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { jsonHasNUL } from '../../../src/utils/index.ts';

describe('jsonHasNUL', () => {
  it('finds a NUL escape in a value', () => {
    strictEqual(jsonHasNUL('{"a":"x\\u0000"}'), true);
  });

  it('finds a NUL escape in a key', () => {
    strictEqual(jsonHasNUL('{"\\u0000":1}'), true);
  });

  it('finds a NUL escape after an escaped backslash', () => {
    strictEqual(jsonHasNUL('["\\\\\\u0000"]'), true);
  });

  it('finds a NUL escape past an escaped backslash that is not one', () => {
    strictEqual(jsonHasNUL('["\\\\u0000","\\u0000"]'), true);
  });

  it('ignores an escaped backslash followed by the letters `u0000`', () => {
    strictEqual(jsonHasNUL('["\\\\u0000"]'), false);
  });

  it('finds a raw NUL', () => {
    strictEqual(jsonHasNUL('"a\u0000"'), true);
  });

  it('passes text without NUL', () => {
    strictEqual(jsonHasNUL('{"a":"\\u0001","b":"u0000"}'), false);
    strictEqual(jsonHasNUL(''), false);
  });
});
