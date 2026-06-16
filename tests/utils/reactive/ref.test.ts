import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { effect } from '../../../src/utils/reactive/effect.ts';
import { ref } from '../../../src/utils/reactive/ref.ts';

describe('ref', () => {
  it('reads the initial value', () => {
    const r = ref(7);
    strictEqual(r.value, 7);
  });

  it('writes update the value', () => {
    const r = ref(0);
    r.value = 1;
    strictEqual(r.value, 1);
  });

  it('triggers subscribers when the value changes', () => {
    const r = ref(0);
    let runs = 0;
    effect(() => {
      void r.value;
      runs++;
    });
    strictEqual(runs, 1);
    r.value = 1;
    strictEqual(runs, 2);
  });

  it('does not trigger when writing an `Object.is`-equal value', () => {
    const r = ref(1);
    let runs = 0;
    effect(() => {
      void r.value;
      runs++;
    });
    r.value = 1;
    strictEqual(runs, 1);
  });

  it('treats `NaN`-to-`NaN` writes as no-ops (Object.is semantics)', () => {
    const r = ref(Number.NaN);
    let runs = 0;
    effect(() => {
      void r.value;
      runs++;
    });
    r.value = Number.NaN;
    strictEqual(runs, 1);
  });

  it('supports multiple independent subscribers', () => {
    const r = ref(0);
    let a = 0;
    let b = 0;
    effect(() => {
      void r.value;
      a++;
    });
    effect(() => {
      void r.value;
      b++;
    });
    r.value = 1;
    strictEqual(a, 2);
    strictEqual(b, 2);
  });
});
