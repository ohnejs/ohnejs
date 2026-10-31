import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { WidenStrings } from '../../../src/utils/index.ts';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

describe('WidenStrings', () => {
  it('widens string literals and unions at any depth', () => {
    const x: Equal<
      WidenStrings<{ locale?: 'de' | 'fr'; nested: { tags: 'a'[] } }>,
      { locale?: string; nested: { tags: string[] } }
    > = true;
    strictEqual(x, true);
  });

  it('keeps tuples and readonly arrays', () => {
    const tuple: Equal<WidenStrings<['a', 1]>, [string, 1]> = true;
    const frozen: Equal<WidenStrings<readonly 'a'[]>, readonly string[]> = true;
    strictEqual(tuple && frozen, true);
  });

  it('keeps non-string members of a union', () => {
    const x: Equal<WidenStrings<'1mb' | number | false>, string | number | false> = true;
    strictEqual(x, true);
  });

  it('passes functions through unchanged', () => {
    const x: Equal<WidenStrings<(a: 'x') => 'y'>, (a: 'x') => 'y'> = true;
    strictEqual(x, true);
  });
});
