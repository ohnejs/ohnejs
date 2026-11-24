import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { flush } from '../../../src/utils/reactive/_scheduler.ts';
import { effectScope } from '../../../src/utils/reactive/effect-scope.ts';
import { ref } from '../../../src/utils/reactive/ref.ts';
import { type FakeElement } from '../_fake-dom.ts';

const { elapsed } = await import('../../../src/dashboard/ui/elapsed.ts');

describe('elapsed', () => {
  it('ticks the time since the moment every second in a `<time>`', (t) => {
    t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 100_000 });
    const scope = effectScope();
    const element = scope.run(() => elapsed(() => 100_000 - 64_000)) as unknown as FakeElement;
    strictEqual(element.tagName, 'TIME');
    strictEqual(element.textContent, '1:04');
    strictEqual(element.getAttribute('datetime'), 'PT64S');
    t.mock.timers.tick(1000);
    flush();
    strictEqual(element.textContent, '1:05');
    scope.dispose();
  });

  it('stays empty while the moment is `null`, then follows the ref', (t) => {
    t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 0 });
    const since = ref<number | null>(null);
    const scope = effectScope();
    const element = scope.run(() =>
      elapsed(() => since.value, { size: 1 }),
    ) as unknown as FakeElement;
    strictEqual(element.textContent, '');
    strictEqual(element.getAttribute('datetime'), null);
    strictEqual(element.getAttribute('style'), '--ohne-size: 1');
    t.mock.timers.tick(5000);
    since.value = Date.now();
    flush();
    strictEqual(element.textContent, '0:00');
    t.mock.timers.tick(3000);
    flush();
    strictEqual(element.textContent, '0:03');
    since.value = null;
    flush();
    strictEqual(element.textContent, '');
    scope.dispose();
  });

  it('stops ticking when its scope is disposed', (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const scope = effectScope();
    scope.run(() => elapsed(() => 0));
    const now = t.mock.method(Date, 'now');
    t.mock.timers.tick(1000);
    strictEqual(now.mock.callCount(), 1);
    scope.dispose();
    t.mock.timers.tick(2000);
    strictEqual(now.mock.callCount(), 1);
  });
});
