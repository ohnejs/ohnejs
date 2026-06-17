import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { RequireByShape } from '../../../src/utils/index.ts';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type IsRequired<T, K extends keyof T> = {} extends Pick<T, K> ? false : true;

interface Sample {
  a?: string | null;
  nested?: { x?: number; y?: boolean };
  plain?: string | string[];
}
type R = RequireByShape<Sample, { a: true; nested: { x: true } }>;

describe('RequireByShape', () => {
  it('requires a shaped key while keeping its declared type', () => {
    const type: Equal<R['a'], string | null> = true;
    const required: IsRequired<R, 'a'> = true;
    strictEqual(type && required, true);
  });

  it('recurses into nested shapes, leaving siblings optional', () => {
    const type: Equal<R['nested']['x'], number> = true;
    const required: IsRequired<R['nested'], 'x'> = true;
    const siblingOptional: IsRequired<R['nested'], 'y'> = false;
    strictEqual(type && required && !siblingOptional, true);
  });

  it('leaves keys absent from the shape untouched', () => {
    const type: Equal<R['plain'], string | string[] | undefined> = true;
    const optional: IsRequired<R, 'plain'> = false;
    strictEqual(type && !optional, true);
  });
});
