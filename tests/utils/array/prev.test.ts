import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { prev } from '../../../src/utils/index.ts';

describe('prev', () => {
  it('returns the preceding item', () => {
    strictEqual(prev('bar', ['foo', 'bar', 'baz']), 'foo');
  });

  it('compares object items by `prop`', () => {
    const items = [{ id: 1 }, { id: 2 }, { id: 3 }];
    strictEqual(prev({ id: 2 }, items, { prop: 'id' }), items[0]);
  });

  it('clamps at the first item without `loop`', () => {
    strictEqual(prev('foo', ['foo', 'bar']), 'foo');
  });

  it('wraps to the last item with `loop`', () => {
    strictEqual(prev('foo', ['foo', 'bar'], { loop: true }), 'bar');
  });

  it('loops a single-element array onto itself', () => {
    strictEqual(prev('foo', ['foo'], { loop: true }), 'foo');
  });

  it('returns undefined when `current` is not found', () => {
    strictEqual(prev('baz', ['foo', 'bar']), undefined);
  });

  it('falls back to the first item with `fallback`', () => {
    strictEqual(prev('baz', ['foo', 'bar'], { fallback: true }), 'foo');
  });

  it('returns undefined for an empty array even with `fallback`', () => {
    strictEqual(prev('foo', [], { fallback: true }), undefined);
  });
});
