import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { computed } from '../../../src/utils/reactive/computed.ts';
import { effect } from '../../../src/utils/reactive/effect.ts';
import { ref } from '../../../src/utils/reactive/ref.ts';
import { untracked } from '../../../src/utils/reactive/untracked.ts';

describe('untracked', () => {
  it('does not subscribe the outer effect to reads inside', () => {
    const r = ref(0);
    let runs = 0;
    effect(() => {
      untracked(() => r.value);
      runs++;
    });
    r.value = 1;
    strictEqual(runs, 1);
  });

  it('returns the function result', () => {
    const r = ref(7);
    strictEqual(
      untracked(() => r.value + 1),
      8,
    );
  });

  it('restores the outer tracking context after returning', () => {
    const a = ref(0);
    const b = ref(0);
    let runs = 0;
    effect(() => {
      untracked(() => b.value);
      void a.value;
      runs++;
    });
    b.value = 1;
    strictEqual(runs, 1);

    a.value = 1;
    strictEqual(runs, 2);
  });

  it('does not re-trigger the outer effect on a self-write inside', () => {
    const r = ref(0);
    let runs = 0;
    effect(() => {
      void r.value;
      runs++;
      if (runs < 5) untracked(() => (r.value = r.value + 1));
    });
    strictEqual(runs, 1);
    strictEqual(r.value, 1);
  });

  it('a computed first evaluated inside still tracks its own deps', () => {
    const r = ref(1);
    const c = computed(() => r.value * 2);
    untracked(() => {
      strictEqual(c.value, 2);
    });
    r.value = 5;
    strictEqual(c.value, 10);
  });

  it('an effect created inside still tracks and re-runs on dep change', () => {
    const r = ref(0);
    let runs = 0;
    untracked(() => {
      effect(() => {
        void r.value;
        runs++;
      });
    });
    strictEqual(runs, 1);
    r.value = 1;
    strictEqual(runs, 2);
  });
});
