import { strictEqual } from 'node:assert';
import { before, describe, it } from 'node:test';

import { flush } from '../../../../src/utils/reactive/_scheduler.ts';
import { FakeElement, findElement } from '../../../dashboard/_fake-dom.ts';
import { baseBrowser } from '../_browser.ts';
import { clicks } from './_clicks.ts';

type LoginForm = typeof import('../../../../src/base/dashboard/components/login-form.ts');

describe('loginForm', () => {
  let loginForm!: LoginForm['loginForm'];

  before(async () => {
    baseBrowser('/login');
    clicks();
    ({ loginForm } = await import('../../../../src/base/dashboard/components/login-form.ts'));
  });

  it('names the password reveal toggle after its state', () => {
    const root = loginForm() as unknown as FakeElement;
    flush();
    const reveal = findElement(root, (element) => element.attributes.has('aria-pressed'));
    strictEqual(reveal?.getAttribute('aria-pressed'), 'false');
    strictEqual(reveal?.getAttribute('aria-label'), 'dashboard.login.showPassword');
    (reveal as unknown as { click(): void }).click();
    flush();
    strictEqual(reveal?.getAttribute('aria-pressed'), 'true');
    strictEqual(reveal?.getAttribute('aria-label'), 'dashboard.login.hidePassword');
  });

  it('keeps focus in the password input when the reveal toggle is pressed', () => {
    const presses = new Map<FakeElement, (event: unknown) => void>();
    const listen = FakeElement.prototype.addEventListener;
    Object.assign(FakeElement.prototype, {
      addEventListener(this: FakeElement, type: string, listener: (event: unknown) => void) {
        if (type === 'mousedown') presses.set(this, listener);
        Reflect.apply(listen, this, [type, listener]);
      },
    });
    const root = loginForm() as unknown as FakeElement;
    Object.assign(FakeElement.prototype, { addEventListener: listen });
    const reveal = findElement(root, (element) => element.attributes.has('aria-pressed'));
    let prevented = false;
    presses.get(reveal as FakeElement)?.({ preventDefault: () => (prevented = true) });
    strictEqual(prevented, true);
  });
});
