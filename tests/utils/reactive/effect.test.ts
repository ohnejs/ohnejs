import { doesNotThrow, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { effect } from '../../../src/utils/reactive/effect.ts';
import { ref } from '../../../src/utils/reactive/ref.ts';

describe('effect', () => {
  it('runs immediately on creation', () => {
    let runs = 0;
    effect(() => {
      runs++;
    });
    strictEqual(runs, 1);
  });

  it('re-runs when any tracked ref changes', () => {
    const a = ref(0);
    const b = ref(0);
    let runs = 0;
    effect(() => {
      void a.value;
      void b.value;
      runs++;
    });
    a.value = 1;
    b.value = 1;
    strictEqual(runs, 3);
  });

  it('`stop` detaches the effect from future triggers', () => {
    const r = ref(0);
    let runs = 0;
    const stop = effect(() => {
      void r.value;
      runs++;
    });
    r.value = 1;
    stop();
    r.value = 2;
    strictEqual(runs, 2);
  });

  it('cleans up stale dependencies on re-run', () => {
    const cond = ref(true);
    const a = ref('a');
    const b = ref('b');
    let last = '';
    effect(() => {
      last = cond.value ? a.value : b.value;
    });
    strictEqual(last, 'a');

    cond.value = false;
    strictEqual(last, 'b');

    a.value = 'A';
    strictEqual(last, 'b');

    b.value = 'B';
    strictEqual(last, 'B');
  });

  it('does not re-trigger itself on a self-write to a tracked ref', () => {
    const r = ref(0);
    let runs = 0;
    effect(() => {
      void r.value;
      runs++;
      if (runs < 5) r.value = r.value + 1;
    });
    strictEqual(runs, 1);
    strictEqual(r.value, 1);
  });

  it('supports nested effects', () => {
    const a = ref(0);
    const b = ref(0);
    let outerRuns = 0;
    let innerRuns = 0;

    effect(() => {
      outerRuns++;
      void a.value;
      effect(() => {
        innerRuns++;
        void b.value;
      });
    });

    strictEqual(outerRuns, 1);
    strictEqual(innerRuns, 1);

    b.value = 1;
    strictEqual(outerRuns, 1);
    strictEqual(innerRuns, 2);

    a.value = 1;
    strictEqual(outerRuns, 2);
    strictEqual(innerRuns, 3);
  });

  it('does not leave a zombie subscriber when `fn` throws on creation', () => {
    const r = ref(0);
    try {
      effect(() => {
        void r.value;
        throw new Error('init');
      });
    } catch {}
    doesNotThrow(() => {
      r.value = 1;
    });
  });
});
