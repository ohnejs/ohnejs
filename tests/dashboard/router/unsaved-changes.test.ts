import { strictEqual } from 'node:assert';
import { before, describe, it } from 'node:test';

import { effectScope } from '../../../src/utils/reactive/effect-scope.ts';
import { ref } from '../../../src/utils/reactive/ref.ts';
import { fakeBrowser } from './_browser.ts';

const listeners = new Map<string, (event: unknown) => void>();

type Router = typeof import('../../../src/dashboard/router/router.ts');
type Unsaved = typeof import('../../../src/dashboard/router/unsaved-changes.ts');

describe('useUnsavedChanges', () => {
  let router!: Router;
  let unsaved!: Unsaved;

  before(async () => {
    fakeBrowser('/raids');
    Object.assign(globalThis, {
      window: {
        addEventListener: (type: string, listener: (event: unknown) => void) =>
          listeners.set(type, listener),
        removeEventListener: (type: string) => listeners.delete(type),
      },
    });
    router = await import('../../../src/dashboard/router/router.ts');
    unsaved = await import('../../../src/dashboard/router/unsaved-changes.ts');
  });

  it('holds a navigation on the leave prompt while its scope is dirty', async () => {
    const dirty = ref(true);
    let answer = false;
    let asked = 0;
    const scope = effectScope();
    scope.run(() => {
      unsaved.useUnsavedChanges(() => dirty.value);
      unsaved.registerLeavePrompt(async () => {
        asked++;
        return answer;
      });
    });
    strictEqual(await router.navigate('/guilds'), false);
    strictEqual(location.pathname, '/raids');
    answer = true;
    strictEqual(await router.navigate('/guilds'), true);
    strictEqual(location.pathname, '/guilds');
    dirty.value = false;
    strictEqual(await router.navigate('/raids'), true);
    strictEqual(asked, 2);
    scope.dispose();
  });

  it('leaves at once without a registered prompt', async () => {
    const scope = effectScope();
    scope.run(() => unsaved.useUnsavedChanges(() => true));
    strictEqual(await unsaved.confirmLeave(), true);
    strictEqual(await router.navigate('/guilds'), true);
    scope.dispose();
  });

  it('drops every source on release and when its scope is disposed', async () => {
    const scope = effectScope();
    scope.run(() => {
      unsaved.useUnsavedChanges(() => true);
      unsaved.registerLeavePrompt(async () => false);
    });
    strictEqual(unsaved.hasUnsavedChanges(), true);
    unsaved.releaseUnsavedChanges();
    strictEqual(unsaved.hasUnsavedChanges(), false);
    strictEqual(await router.navigate('/raids'), true);
    strictEqual(await unsaved.confirmLeave(), false);
    scope.dispose();
    strictEqual(await unsaved.confirmLeave(), true);
  });

  it('raises the tab-close prompt only while a source is dirty', () => {
    const dirty = ref(false);
    const scope = effectScope();
    scope.run(() => unsaved.useUnsavedChanges(() => dirty.value));
    const close = listeners.get('beforeunload');
    const event = {
      defaultPrevented: false,
      returnValue: 'unset',
      preventDefault: () => {},
    };
    event.preventDefault = () => (event.defaultPrevented = true);
    close?.(event);
    strictEqual(event.defaultPrevented, false);
    dirty.value = true;
    close?.(event);
    strictEqual(event.defaultPrevented, true);
    strictEqual(event.returnValue, '');
    scope.dispose();
    strictEqual(listeners.has('beforeunload'), false);
  });
});
