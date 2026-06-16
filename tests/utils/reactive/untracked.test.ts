import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

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
});
