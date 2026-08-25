import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { next } from '../../../src/utils/index.ts';

describe('next', () => {
  it('returns the following item', () => {
    strictEqual(next('bar', ['foo', 'bar', 'baz']), 'baz');
  });

  it('compares object items by `prop`', () => {
    const items = [{ id: 1 }, { id: 2 }, { id: 3 }];
    strictEqual(next({ id: 2 }, items, { prop: 'id' }), items[2]);
  });

  it('clamps at the last item without `loop`', () => {
    strictEqual(next('bar', ['foo', 'bar']), 'bar');
  });

  it('wraps to the first item with `loop`', () => {
    strictEqual(next('bar', ['foo', 'bar'], { loop: true }), 'foo');
  });

  it('loops a single-element array onto itself', () => {
    strictEqual(next('foo', ['foo'], { loop: true }), 'foo');
  });

  it('returns undefined when `current` is not found', () => {
    strictEqual(next('baz', ['foo', 'bar']), undefined);
  });

  it('falls back to the first item with `fallback`', () => {
    strictEqual(next('baz', ['foo', 'bar'], { fallback: true }), 'foo');
  });

  it('returns undefined for an empty array even with `fallback`', () => {
    strictEqual(next('foo', [], { fallback: true }), undefined);
  });
});
