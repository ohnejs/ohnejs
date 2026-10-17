import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { effectScope, nextTick, ref } from '../../../../src/utils/index.ts';
import { baseBrowser } from '../_browser.ts';

baseBrowser('/');
Object.assign(document.body.classList, { contains: () => false });
const keydowns: ((event: unknown) => void)[] = [];
Object.assign(document, {
  activeElement: document.body,
  addEventListener: (type: string, listener: (event: unknown) => void) => {
    if (type === 'keydown') keydowns.push(listener);
  },
});
const { isMac } = await import('../../../../src/dashboard/ui/hotkeys.ts');
const { historyScrollState } =
  await import('../../../../src/base/dashboard/components/history-scroll-state.ts');

/**
 * Presses the platform undo hotkey on `document`.
 */
function pressUndo(): void {
  const mac = isMac();
  const event = { key: 'z', metaKey: mac, ctrlKey: !mac, altKey: false, shiftKey: false };
  for (const listener of keydowns) listener({ ...event, defaultPrevented: false });
}

describe('historyScrollState', () => {
  it('puts the offset back once the restore flushes, and leaves a later scroll standing', async () => {
    const y = ref(300);
    const written: number[] = [];
    effectScope().run(() =>
      historyScrollState({
        y: () => y.value,
        setY: (value) => {
          written.push(value);
          y.value = value;
        },
      }),
    );
    pressUndo();
    y.value = 0;
    await nextTick();
    deepStrictEqual([y.value, written], [300, [300]]);
    y.value = 900;
    await nextTick();
    deepStrictEqual([y.value, written], [900, [300]]);
  });
});
