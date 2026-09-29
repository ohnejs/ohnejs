import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { DeepPrettify } from '../../../src/utils/index.ts';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

describe('DeepPrettify', () => {
  it('collapses an intersection into one object', () => {
    const x: Equal<DeepPrettify<{ a: string } & { b: number }>, { a: string; b: number }> = true;
    strictEqual(x, true);
  });

  it('flattens nested intersections', () => {
    const x: Equal<
      DeepPrettify<{ a: { b: string } & { c: number } }>,
      { a: { b: string; c: number } }
    > = true;
    strictEqual(x, true);
  });

  it('passes arrays and functions through unchanged', () => {
    const arr: Equal<DeepPrettify<string[]>, string[]> = true;
    const fn: Equal<DeepPrettify<(a: string) => number>, (a: string) => number> = true;
    strictEqual(arr && fn, true);
  });

  it('keeps a branded string, like the open half of `LiteralUnion`, a string', () => {
    const x: Equal<DeepPrettify<'a' | (string & {})>, 'a' | (string & {})> = true;
    strictEqual(x, true);
  });

  it('leaves primitives unchanged', () => {
    const x: Equal<DeepPrettify<number>, number> = true;
    strictEqual(x, true);
  });
});
