import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';
import { useConfig, useLayers } from 'ohne';
import { effect } from 'ohne/utils';

declare module 'ohne' {
  interface Config {
    /**
     * Test: `foo`
     */
    foo?: number;

    /**
     * Test: `tags`
     */
    tags?: string[];
  }
}

describe('useLayers / useConfig', () => {
  it('useLayers returns the same registry instance across calls', () => {
    strictEqual(useLayers(), useLayers());
  });

  it('useConfig delegates to useLayers().resolve()', () => {
    useLayers().add({ path: '/test-delegation', defaults: { foo: 7 } });
    strictEqual(useConfig(), useLayers().resolve());
  });

  it('flows registered layers through useConfig', () => {
    const layers = useLayers();
    layers.add({ path: '/test-foo-base', defaults: { foo: 1 } });
    strictEqual(useConfig().foo, 1);

    layers.add({ path: '/test-foo-over', input: { foo: 2 } });
    strictEqual(useConfig().foo, 2);
  });

  it('applies a strategy set via the registry', () => {
    const layers = useLayers();
    layers.setStrategy('tags', 'concat-unique');
    layers.add({ path: '/test-tags-base', defaults: { tags: ['a'] } });
    layers.add({ path: '/test-tags-add', input: { tags: ['b'] } });

    deepStrictEqual(useConfig().tags, ['b', 'a']);
  });

  it('returns the cached layers array between mutations', () => {
    const layers = useLayers();
    const first = layers.layers();
    const second = layers.layers();
    strictEqual(first, second);
  });

  it('useConfig inside an effect re-runs on layer mutations', () => {
    let runs = 0;
    effect(() => {
      useConfig();
      runs++;
    });
    const before = runs;
    useLayers().add({ path: '/test-reactive-effect', defaults: { foo: 99 } });
    strictEqual(runs, before + 1);
    useLayers().remove('/test-reactive-effect');
  });
});
