import { deepStrictEqual, strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { createLayerRegistry, effect, last } from '../../../src/utils/index.ts';

describe('createLayerRegistry', () => {
  it('starts empty', () => {
    const r = createLayerRegistry<{ a: number }>();
    deepStrictEqual(r.layers(), []);
    deepStrictEqual(r.resolve(), {});
    deepStrictEqual(r.strategies(), {});
  });

  it('resolves a single layer via withDefaults', () => {
    interface Config {
      a: number;
      b: number;
    }
    const r = createLayerRegistry<Config>();
    r.add({ path: '/p', defaults: { a: 1, b: 2 }, input: { a: 10 } });
    const [layer] = r.layers();
    strictEqual(layer!.path, '/p');
    deepStrictEqual(layer!.defaults, { a: 1, b: 2 });
    deepStrictEqual(layer!.input, { a: 10 });
    deepStrictEqual(layer!.resolved, { a: 10, b: 2 });
  });

  it('folds layers cumulatively with closer winning', () => {
    interface Config {
      a: number;
      b: number;
      c: number;
    }
    const r = createLayerRegistry<Config>();
    r.add({ path: '/base', defaults: { a: 1, b: 1, c: 1 } });
    r.add({ path: '/mid', input: { b: 2 } });
    r.add({ path: '/closer', input: { c: 3 } });
    const layers = r.layers();
    deepStrictEqual(layers[0]!.resolved, { a: 1, b: 1, c: 1 });
    deepStrictEqual(layers[1]!.resolved, { a: 1, b: 2, c: 1 });
    deepStrictEqual(layers[2]!.resolved, { a: 1, b: 2, c: 3 });
  });

  it('resolve returns the closest layer resolved config', () => {
    interface Config {
      a: number;
    }
    const r = createLayerRegistry<Config>();
    r.add({ path: '/a', defaults: { a: 1 } });
    r.add({ path: '/b', input: { a: 2 } });
    const layers = r.layers();
    deepStrictEqual(r.resolve(), last(layers)!.resolved);
    deepStrictEqual(r.resolve(), { a: 2 });
  });

  it('applies option strategies to per-layer resolve', () => {
    interface Config {
      tags: string[];
    }
    const r = createLayerRegistry<Config>({ strategies: { tags: 'concat-unique' } });
    r.add({ path: '/p', defaults: { tags: ['a'] }, input: { tags: ['b'] } });
    deepStrictEqual(r.layers()[0]!.resolved, { tags: ['b', 'a'] });
  });

  it('applies option strategies to cross-layer fold', () => {
    interface Config {
      tags: string[];
    }
    const r = createLayerRegistry<Config>({ strategies: { tags: 'concat-unique' } });
    r.add({ path: '/base', defaults: { tags: ['a'] } });
    r.add({ path: '/closer', input: { tags: ['b'] } });
    deepStrictEqual(r.resolve(), { tags: ['b', 'a'] });
  });

  it('setStrategy() extends and overrides strategies', () => {
    interface Config {
      tags: string[];
    }
    const r = createLayerRegistry<Config>({ strategies: { tags: 'concat' } });
    r.add({ path: '/p', defaults: { tags: ['a'] }, input: { tags: ['a', 'b'] } });
    deepStrictEqual(r.layers()[0]!.resolved, { tags: ['a', 'b', 'a'] });
    r.setStrategy('tags', 'concat-unique');
    deepStrictEqual(r.layers()[0]!.resolved, { tags: ['a', 'b'] });
  });

  it('caches layers between mutations', () => {
    const r = createLayerRegistry<{ a: number }>();
    r.add({ path: '/p', input: { a: 1 } });
    const first = r.layers();
    const second = r.layers();
    strictEqual(first, second);
  });

  it('invalidates cache on add', () => {
    const r = createLayerRegistry<{ a: number }>();
    r.add({ path: '/p', input: { a: 1 } });
    const first = r.layers();
    r.add({ path: '/q', input: { a: 2 } });
    const second = r.layers();
    strictEqual(first === second, false);
  });

  it('invalidates cache on strategy change', () => {
    const r = createLayerRegistry<{ a: number }>();
    r.add({ path: '/p', input: { a: 1 } });
    const first = r.layers();
    r.setStrategy('a', 'replace');
    const second = r.layers();
    strictEqual(first === second, false);
  });

  it('keeps every layer permanently in insertion order', () => {
    const r = createLayerRegistry<{ a: number }>();
    r.add({ path: '/a', input: { a: 1 } });
    r.add({ path: '/b', input: { a: 2 } });
    r.add({ path: '/c', input: { a: 3 } });
    deepStrictEqual(
      r.layers().map((l) => l.path),
      ['/a', '/b', '/c'],
    );
  });

  it('normalises missing defaults and input to {}', () => {
    const r = createLayerRegistry<{ a: number }>();
    r.add({ path: '/empty' });
    const [layer] = r.layers();
    deepStrictEqual(layer!.defaults, {});
    deepStrictEqual(layer!.input, {});
    deepStrictEqual(layer!.resolved, {});
  });

  it('strategies() returns a fresh shallow copy', () => {
    const r = createLayerRegistry<{ a: number }>({ strategies: { a: 'replace' } });
    const first = r.strategies();
    const second = r.strategies();
    deepStrictEqual(first, { a: 'replace' });
    strictEqual(first === second, false);
    first['a'] = 'concat';
    deepStrictEqual(r.strategies(), { a: 'replace' });
  });

  it('recursively merges nested plain objects', () => {
    interface Config {
      db?: { host?: string; port?: number };
    }
    const r = createLayerRegistry<Config>();
    r.add({ path: '/base', defaults: { db: { host: 'localhost', port: 5432 } } });
    r.add({ path: '/closer', input: { db: { host: 'prod' } } });
    deepStrictEqual(r.resolve(), { db: { host: 'prod', port: 5432 } });
  });

  it('does not mutate caller-supplied defaults or input', () => {
    interface Config {
      tags: string[];
    }
    const defaults = { tags: ['a'] };
    const input = { tags: ['b'] };
    const r = createLayerRegistry<Config>({ strategies: { tags: 'concat' } });
    r.add({ path: '/p', defaults, input });
    r.resolve();
    deepStrictEqual(defaults, { tags: ['a'] });
    deepStrictEqual(input, { tags: ['b'] });
  });

  it('resolves an empty registry to {}', () => {
    const r = createLayerRegistry<{ a: number; b: number }>();
    deepStrictEqual(r.resolve(), {});
  });

  it('add throws when a layer is already registered at the same path', () => {
    const r = createLayerRegistry<{ a: number }>();
    r.add({ path: '/p', input: { a: 1 } });
    throws(() => r.add({ path: '/p', input: { a: 2 } }), /already registered/);
  });

  it('remove drops the layer at the given path', () => {
    const r = createLayerRegistry<{ a: number }>();
    r.add({ path: '/a', defaults: { a: 1 } });
    r.add({ path: '/b', input: { a: 2 } });
    strictEqual(r.remove('/a'), true);
    deepStrictEqual(
      r.layers().map((l) => l.path),
      ['/b'],
    );
  });

  it('remove returns false when no layer matches', () => {
    const r = createLayerRegistry<{ a: number }>();
    r.add({ path: '/p', input: { a: 1 } });
    strictEqual(r.remove('/missing'), false);
    strictEqual(r.layers().length, 1);
  });

  it('remove invalidates the cache', () => {
    const r = createLayerRegistry<{ a: number }>();
    r.add({ path: '/a', input: { a: 1 } });
    r.add({ path: '/b', input: { a: 2 } });
    const first = r.layers();
    r.remove('/a');
    const second = r.layers();
    strictEqual(first === second, false);
  });

  it('add accepts a path after remove', () => {
    const r = createLayerRegistry<{ a: number }>();
    r.add({ path: '/p', defaults: { a: 1 } });
    r.remove('/p');
    r.add({ path: '/p', input: { a: 99 } });
    deepStrictEqual(r.resolve(), { a: 99 });
  });

  describe('reactivity', () => {
    it('`resolve` inside an effect re-runs on `add`', () => {
      const r = createLayerRegistry<{ a: number }>();
      let seen: number | undefined;
      effect(() => {
        seen = r.resolve().a;
      });
      strictEqual(seen, undefined);
      r.add({ path: '/p', defaults: { a: 1 } });
      strictEqual(seen, 1);
    });

    it('`resolve` inside an effect re-runs on `remove`', () => {
      const r = createLayerRegistry<{ a: number }>();
      r.add({ path: '/p', defaults: { a: 1 } });
      let runs = 0;
      effect(() => {
        r.resolve();
        runs++;
      });
      strictEqual(runs, 1);
      r.remove('/p');
      strictEqual(runs, 2);
    });

    it('`resolve` inside an effect re-runs on `strategy`', () => {
      const r = createLayerRegistry<{ tags: string[] }>();
      r.add({ path: '/base', defaults: { tags: ['a'] } });
      r.add({ path: '/over', input: { tags: ['b'] } });
      let snapshot: string[] = [];
      effect(() => {
        snapshot = r.resolve().tags ?? [];
      });
      deepStrictEqual(snapshot, ['b']);
      r.setStrategy('tags', 'concat-unique');
      deepStrictEqual(snapshot, ['b', 'a']);
    });

    it('`layers` and `strategies` reads also subscribe', () => {
      const r = createLayerRegistry<{ a: number }>();
      let layersRuns = 0;
      let stratsRuns = 0;
      effect(() => {
        r.layers();
        layersRuns++;
      });
      effect(() => {
        r.strategies();
        stratsRuns++;
      });
      strictEqual(layersRuns, 1);
      strictEqual(stratsRuns, 1);
      r.add({ path: '/p', defaults: { a: 1 } });
      strictEqual(layersRuns, 2);
      strictEqual(stratsRuns, 2);
    });
  });
});
