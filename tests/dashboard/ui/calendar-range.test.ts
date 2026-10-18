import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { flush } from '../../../src/utils/reactive/_scheduler.ts';
import { effectScope } from '../../../src/utils/reactive/effect-scope.ts';
import { ref } from '../../../src/utils/reactive/ref.ts';
import { type FakeElement, findElement } from '../_fake-dom.ts';
import '../fields/_controls.ts';

const { calendarRange } = await import('../../../src/dashboard/ui/calendar-range.ts');

const DAY = 86_400_000;

/**
 * The elements under `root` whose class list holds `name`.
 */
function withClass(root: FakeElement, name: string): FakeElement[] {
  const found: FakeElement[] = [];
  findElement(root, (element) => {
    if ((element.getAttribute('class') ?? '').split(' ').includes(name)) found.push(element);
    return false;
  });
  return found;
}

describe('calendarRange', () => {
  it('clears each handle on its own terms, falling back to `clearable`', () => {
    effectScope().run(() => {
      const pair = ref<[number | null, number | null]>([0, DAY]);
      const clears = (options: Parameters<typeof calendarRange>[1]) => {
        const element = calendarRange(pair, {
          timezone: 'UTC',
          ...options,
        }) as unknown as FakeElement;
        flush();
        const [from, to] = withClass(element, 'ohne-calendar') as [FakeElement, FakeElement];
        return [
          withClass(from, 'ohne-calendar-clear').length,
          withClass(to, 'ohne-calendar-clear').length,
        ];
      };
      strictEqual(String(clears({ clearableFrom: false, clearableTo: true })), '0,1');
      strictEqual(String(clears({ clearable: false, clearableTo: true })), '0,1');
      strictEqual(String(clears({ clearable: false })), '0,0');
      strictEqual(String(clears({})), '1,1');
    });
  });
});
