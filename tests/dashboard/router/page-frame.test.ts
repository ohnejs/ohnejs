import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { frameOptions, useFrame } from '../../../src/dashboard/router/page-frame.ts';
import { effectScope } from '../../../src/utils/reactive/effect-scope.ts';

describe('useFrame', () => {
  it('merges every live scope, each option on its own', () => {
    const editor = effectScope();
    const live = effectScope();
    editor.run(() => useFrame({ fill: true }));
    live.run(() => useFrame({ wide: true, fill: false }));
    deepStrictEqual(frameOptions(), { fill: true, wide: true });
    editor.dispose();
    deepStrictEqual(frameOptions(), { fill: false, wide: true });
    live.dispose();
    deepStrictEqual(frameOptions(), { fill: false, wide: false });
  });

  it('keeps an option on while any scope asking for it lives', () => {
    const first = effectScope();
    const second = effectScope();
    first.run(() => useFrame({ fill: true }));
    second.run(() => useFrame({ fill: true }));
    first.dispose();
    deepStrictEqual(frameOptions(), { fill: true, wide: false });
    second.dispose();
    deepStrictEqual(frameOptions(), { fill: false, wide: false });
  });
});
