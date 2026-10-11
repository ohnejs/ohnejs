import { strictEqual } from 'node:assert';
import { before, describe, it } from 'node:test';

import { flush } from '../../../../src/utils/reactive/_scheduler.ts';
import { type FakeElement, findElement } from '../../../dashboard/_fake-dom.ts';
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
});
