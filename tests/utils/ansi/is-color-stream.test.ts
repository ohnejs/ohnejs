import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isColorStream } from '../../../src/utils/ansi/index.ts';

describe('isColorStream', () => {
  it('follows the stream isTTY flag', () => {
    strictEqual(isColorStream({ isTTY: true }), true);
    strictEqual(isColorStream({ isTTY: false }), false);
    strictEqual(isColorStream(undefined), false);
  });
});
