import { strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { batchedEffect, computed, effectScope, ref } from '../../../src/utils/index.ts';
import { flush } from '../../../src/utils/reactive/_scheduler.ts';

describe('batchedEffect', () => {
  it('runs immediately on creation', () => {
    let runs = 0;
    batchedEffect(() => runs++);
    strictEqual(runs, 1);
  });

  it('defers a re-run to the next flush', () => {
    const r = ref(0);
    let runs = 0;
    batchedEffect(() => {
      void r.value;
      runs++;
    });
    r.value = 1;
    strictEqual(runs, 1);
    flush();
    strictEqual(runs, 2);
  });

  it('coalesces multiple writes into one re-run', () => {
    const a = ref(0);
    const b = ref(0);
    let runs = 0;
    batchedEffect(() => {
      void a.value;
      void b.value;
      runs++;
    });
    a.value = 1;
    b.value = 1;
    flush();
    strictEqual(runs, 2);
  });

  it('reads the latest computed value in the batched run', () => {
    const r = ref(1);
    const double = computed(() => r.value * 2);
    let seen = 0;
    batchedEffect(() => (seen = double.value));
    strictEqual(seen, 2);
    r.value = 5;
    flush();
    strictEqual(seen, 10);
  });

  it('cancels the pending re-run when stopped before the flush', () => {
    const r = ref(0);
    let runs = 0;
    const stop = batchedEffect(() => {
      void r.value;
      runs++;
    });
    r.value = 1;
    stop();
    flush();
    strictEqual(runs, 1);
  });

  it('leaves no zombie subscriber after a first-run throw', () => {
    const r = ref(0);
    let runs = 0;
    throws(
      () =>
        batchedEffect(() => {
          void r.value;
          runs++;
          throw new Error('boom');
        }),
      /boom/,
    );
    strictEqual(runs, 1);
    r.value = 1;
    flush();
    strictEqual(runs, 1);
  });

  it('stops when the enclosing scope is disposed', () => {
    const scope = effectScope();
    const r = ref(0);
    let runs = 0;
    scope.run(() =>
      batchedEffect(() => {
        void r.value;
        runs++;
      }),
    );
    scope.dispose();
    r.value = 1;
    flush();
    strictEqual(runs, 1);
  });
});
