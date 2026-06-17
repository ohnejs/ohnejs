import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { Defined } from '../../../src/utils/index.ts';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

describe('Defined', () => {
  it('strips undefined', () => {
    const x: Equal<Defined<string | undefined>, string> = true;
    strictEqual(x, true);
  });

  it('keeps null', () => {
    const x: Equal<Defined<string | null | undefined>, string | null> = true;
    const y: Equal<Defined<string | null>, string | null> = true;
    strictEqual(x && y, true);
  });

  it('reduces a lone undefined to never', () => {
    const x: Equal<Defined<undefined>, never> = true;
    strictEqual(x, true);
  });
});
