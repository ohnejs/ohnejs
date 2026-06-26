import { strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { computed } from '../../../src/utils/reactive/computed.ts';
import { effect } from '../../../src/utils/reactive/effect.ts';
import { ref } from '../../../src/utils/reactive/ref.ts';

describe('computed', () => {
  it('lazily evaluates - getter does not run until first read', () => {
    let runs = 0;
    const c = computed(() => {
      runs++;
      return 1;
    });
    strictEqual(runs, 0);
    void c.value;
    strictEqual(runs, 1);
  });

  it('caches the result - subsequent reads do not re-run the getter', () => {
    const r = ref(1);
    let runs = 0;
    const c = computed(() => {
      runs++;
      return r.value;
    });
    void c.value;
    void c.value;
    void c.value;
    strictEqual(runs, 1);
  });

  it('re-evaluates when a tracked dependency changes', () => {
    const r = ref(1);
    let runs = 0;
    const c = computed(() => {
      runs++;
      return r.value * 2;
    });
    strictEqual(c.value, 2);
    r.value = 3;
    strictEqual(c.value, 6);
    strictEqual(runs, 2);
  });

  it('chains - computed reading computed', () => {
    const r = ref(1);
    const a = computed(() => r.value + 1);
    const b = computed(() => a.value * 10);
    strictEqual(b.value, 20);
    r.value = 4;
    strictEqual(b.value, 50);
  });

  it('participates in effect tracking', () => {
    const r = ref(1);
    const c = computed(() => r.value * 2);
    let seen: number[] = [];
    effect(() => {
      seen.push(c.value);
    });
    r.value = 5;
    r.value = 6;
    strictEqual(seen.join(','), '2,10,12');
  });

  it('throws on a cyclic getter', () => {
    let self: { value: number };
    const c = computed<number>(() => self.value + 1);
    self = c;
    throws(() => c.value, /Cyclic computed/);
  });

  it('does not re-run for unrelated changes', () => {
    const a = ref(1);
    const b = ref(2);
    let runs = 0;
    const c = computed(() => {
      runs++;
      return a.value;
    });
    void c.value;
    b.value = 99;
    void c.value;
    strictEqual(runs, 1);
  });

  it('an effect that caught a throw recovers when the dep changes', () => {
    const cond = ref(true);
    const c = computed(() => {
      if (cond.value) throw new Error('not ready');
      return 42;
    });
    let lastValue = -1;
    effect(() => {
      try {
        lastValue = c.value;
      } catch {}
    });
    strictEqual(lastValue, -1);

    cond.value = false;
    strictEqual(lastValue, 42);
  });

  it('never exposes a stale value to an effect that also reads the source', () => {
    const a = ref(1);
    const c = computed(() => a.value * 2);
    const observed: [number, number][] = [];
    effect(() => observed.push([a.value, c.value]));

    a.value = 2;

    for (const [av, cv] of observed) strictEqual(cv, av * 2);
  });

  it('keeps sibling computeds of one source consistent in an effect', () => {
    const a = ref(1);
    const c1 = computed(() => a.value * 2);
    const c2 = computed(() => a.value * 10);
    const observed: [number, number, number][] = [];
    effect(() => observed.push([a.value, c1.value, c2.value]));

    a.value = 2;

    for (const [av, x, y] of observed) {
      strictEqual(x, av * 2);
      strictEqual(y, av * 10);
    }
  });
});
