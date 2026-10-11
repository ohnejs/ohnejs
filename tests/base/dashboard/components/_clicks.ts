import { FakeElement } from '../../../dashboard/_fake-dom.ts';

type Listener = (event: unknown) => void;

const listeners = new WeakMap<FakeElement, Listener[]>();

/**
 * Teaches fake elements `click()`, which runs the `click` listeners they hold.
 */
export function clicks(): void {
  Object.assign(FakeElement.prototype, {
    addEventListener(this: FakeElement, type: string, listener: Listener) {
      if (type === 'click') listeners.set(this, [...(listeners.get(this) ?? []), listener]);
    },
    click(this: FakeElement) {
      for (const listener of listeners.get(this) ?? []) listener({ type: 'click' });
    },
  });
}
