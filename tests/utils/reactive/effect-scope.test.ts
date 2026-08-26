import { deepStrictEqual, doesNotThrow, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { effect, effectScope, type EffectScope, onCleanup, ref } from '../../../src/utils/index.ts';

describe('effectScope', () => {
  it('stops owned effects on dispose', () => {
    const scope = effectScope();
    const r = ref(0);
    let runs = 0;
    scope.run(() =>
      effect(() => {
        void r.value;
        runs++;
      }),
    );
    strictEqual(runs, 1);
    r.value = 1;
    strictEqual(runs, 2);
    scope.dispose();
    r.value = 2;
    strictEqual(runs, 2);
  });

  it('does not re-run an owned effect when a cleanup writes its dependency', () => {
    const scope = effectScope();
    const open = ref(true);
    let runs = 0;
    scope.run(() => {
      effect(() => {
        void open.value;
        runs++;
      });
      onCleanup(() => {
        open.value = false;
      });
    });
    strictEqual(runs, 1);
    scope.dispose();
    strictEqual(runs, 1);
  });

  it('runs cleanups in registration order, exactly once', () => {
    const scope = effectScope();
    const order: number[] = [];
    scope.run(() => {
      onCleanup(() => order.push(1));
      onCleanup(() => order.push(2));
    });
    scope.dispose();
    scope.dispose();
    deepStrictEqual(order, [1, 2]);
  });

  it('disposes nested scopes with the parent', () => {
    const parent = effectScope();
    let cleaned = false;
    parent.run(() => {
      const child = effectScope();
      child.run(() => onCleanup(() => (cleaned = true)));
    });
    parent.dispose();
    strictEqual(cleaned, true);
  });

  it('restores the owning scope when an owned effect re-runs', () => {
    const root = effectScope();
    const r = ref(0);
    let cleanups = 0;
    root.run(() =>
      effect(() => {
        void r.value;
        const inner = effectScope();
        inner.run(() => onCleanup(() => cleanups++));
      }),
    );
    r.value = 1;
    root.dispose();
    strictEqual(cleanups, 2);
  });

  it('disposes an individual child without disposing it twice', () => {
    const parent = effectScope();
    let childCleanups = 0;
    let child!: EffectScope;
    parent.run(() => {
      child = effectScope();
      child.run(() => onCleanup(() => childCleanups++));
    });
    child.dispose();
    strictEqual(childCleanups, 1);
    parent.dispose();
    strictEqual(childCleanups, 1);
  });

  it('swap-removes siblings without losing or double-running any', () => {
    const parent = effectScope();
    const cleaned: number[] = [];
    const children: EffectScope[] = [];
    parent.run(() => {
      for (let i = 0; i < 4; i++) {
        const child = effectScope();
        child.run(() => onCleanup(() => cleaned.push(i)));
        children.push(child);
      }
    });
    (children[0] as EffectScope).dispose();
    (children[2] as EffectScope).dispose();
    parent.dispose();
    deepStrictEqual([...cleaned].sort(), [0, 1, 2, 3]);
  });

  it('keeps a detached scope alive past the creating scope', () => {
    const outer = effectScope();
    const r = ref(0);
    let runs = 0;
    let inner!: EffectScope;
    outer.run(() => {
      inner = effectScope(true);
      inner.run(() =>
        effect(() => {
          void r.value;
          runs++;
        }),
      );
    });
    outer.dispose();
    r.value = 1;
    strictEqual(runs, 2);
    inner.dispose();
    r.value = 2;
    strictEqual(runs, 2);
  });

  it('treats top-level onCleanup as a no-op', () => {
    doesNotThrow(() => onCleanup(() => {}));
  });
});
