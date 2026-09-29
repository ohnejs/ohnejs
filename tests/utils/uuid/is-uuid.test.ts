import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isUUID } from '../../../src/utils/uuid/is-uuid.ts';
import { uuidv7 } from '../../../src/utils/uuid/uuidv7.ts';

describe('isUUID', () => {
  it('accepts a hyphenated UUID of any version, in either case', () => {
    for (const value of [
      uuidv7(),
      crypto.randomUUID(),
      '00000000-0000-0000-0000-000000000000',
      '019F3C1A-8B2D-7F4E-9A6B-1C2D3E4F5A6B',
    ])
      strictEqual(isUUID(value), true, value);
  });

  it('refuses anything but the 36-character hyphenated form', () => {
    for (const value of [
      '019f3c1a8b2d7f4e9a6b1c2d3e4f5a6b',
      '{019f3c1a-8b2d-7f4e-9a6b-1c2d3e4f5a6b}',
      '019f3c1a-8b2d-7f4e-9a6b-1c2d3e4f5a6',
      '019f3c1a-8b2d-7f4e-9a6b-1c2d3e4f5a6g',
      '019f3c1a-8b2d-7f4e-9a6b-1c2d3e4f5a6b\n',
      '../admin',
      '',
      42,
      null,
    ])
      strictEqual(isUUID(value), false, String(value));
  });
});
