import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { jsonDepthWithin } from '../../../src/utils/index.ts';

describe('jsonDepthWithin', () => {
  it('accepts a structure within the cap', () => {
    strictEqual(jsonDepthWithin('{"a":[1,2]}', 2), true);
  });

  it('accepts a structure exactly at the cap', () => {
    strictEqual(jsonDepthWithin('[[]]', 2), true);
  });

  it('rejects a structure past the cap', () => {
    strictEqual(jsonDepthWithin('[[[]]]', 2), false);
  });

  it('ignores brackets inside strings', () => {
    strictEqual(jsonDepthWithin('{"a":"]]]]"}', 1), true);
    strictEqual(jsonDepthWithin('["{{{{{{{"]', 1), true);
  });

  it('does not let an escaped quote end a string', () => {
    strictEqual(jsonDepthWithin('{"a":"x\\"[[[["}', 1), true);
  });

  it('lets an escaped backslash end a string, so the next bracket is structural', () => {
    strictEqual(jsonDepthWithin('["a\\\\",[1]]', 2), true);
    strictEqual(jsonDepthWithin('["a\\\\",[1]]', 1), false);
  });

  it('accepts flat and empty texts', () => {
    strictEqual(jsonDepthWithin('42', 0), true);
    strictEqual(jsonDepthWithin('', 0), true);
    strictEqual(jsonDepthWithin('"[[[["', 0), true);
  });

  it('rejects a depth bomb before it can overflow a parser', () => {
    strictEqual(jsonDepthWithin('['.repeat(100000), 32), false);
  });
});
