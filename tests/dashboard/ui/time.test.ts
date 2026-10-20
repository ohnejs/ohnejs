import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { flush } from '../../../src/utils/reactive/_scheduler.ts';
import { ref } from '../../../src/utils/reactive/ref.ts';
import { type FakeElement, findElement, hasClass } from '../_fake-dom.ts';
import { fire } from './_events.ts';

const { time } = await import('../../../src/dashboard/ui/time.ts');

const clearOf = (root: FakeElement): FakeElement | undefined =>
  findElement(root, (element) => hasClass(element, 'ohne-time-clear'));

const values = (root: FakeElement): string[] => {
  const found: string[] = [];
  findElement(root, (element) => {
    if (hasClass(element, 'ohne-number-input')) found.push((element as { value?: string }).value!);
    return false;
  });
  return found;
};

describe('time', () => {
  it('clears to `null` only while clearable, holding a time, and enabled', () => {
    const model = ref<number | null>(36_000_000);
    const off = ref(false);
    const root = time(model, {
      clearable: true,
      disabled: () => off.value,
    }) as unknown as FakeElement;
    flush();
    off.value = true;
    flush();
    strictEqual(clearOf(root), undefined);
    off.value = false;
    flush();
    fire(clearOf(root)!, 'click');
    flush();
    strictEqual(model.value, null);
    strictEqual(values(root).join(','), ',,');
    strictEqual(clearOf(root), undefined);
    strictEqual(clearOf(time(ref<number | null>(0)) as unknown as FakeElement), undefined);
  });

  it('composes a typed segment of an empty time from `min`', () => {
    const model = ref<number | null>(null);
    const root = time(model, { min: '08:30' }) as unknown as FakeElement;
    flush();
    const [, minutes] = (() => {
      const found: FakeElement[] = [];
      findElement(root, (element) => {
        if (hasClass(element, 'ohne-number-input')) found.push(element);
        return false;
      });
      return found;
    })();
    (minutes as unknown as { value: string }).value = '45';
    fire(minutes!, 'input');
    flush();
    strictEqual(model.value, (8 * 3600 + 45 * 60) * 1000);
  });
});
