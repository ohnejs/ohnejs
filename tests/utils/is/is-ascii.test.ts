import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isASCII } from '../../../src/utils/index.ts';

describe('isASCII', () => {
  it('returns true for a string within the ASCII range', () => {
    strictEqual(isASCII('Hello, World!'), true);
    strictEqual(isASCII(''), true);
    strictEqual(isASCII('\u0000\u007f'), true);
  });

  it('returns false once a character leaves the ASCII range', () => {
    strictEqual(isASCII('Émile'), false);
    strictEqual(isASCII('\u0080'), false);
    strictEqual(isASCII('東'), false);
    strictEqual(isASCII('😀'), false);
  });
});
