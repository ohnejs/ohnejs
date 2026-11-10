import { deepStrictEqual, strictEqual } from 'node:assert';
import { afterEach, before, beforeEach, describe, it } from 'node:test';

import type { UpdateOutcome } from '../../../../src/dashboard/runtime/session.ts';
import type { Sent } from './_popups.ts';

import { startSession } from '../../../../src/dashboard/runtime/_request.ts';
import { effectScope } from '../../../../src/utils/reactive/effect-scope.ts';
import { baseBrowser } from '../_browser.ts';
import {
  body,
  fire,
  idle,
  lastInput,
  recordFetch,
  recordListeners,
  textButton,
} from './_popups.ts';

const USER = { UUID: 'u', email: 'jaina@example.com', roles: [], dashboardLanguage: null };

describe('currentPasswordPopup', () => {
  let currentPasswordPopup!: typeof import('../../../../src/base/dashboard/components/current-password-popup.ts').currentPasswordPopup;
  let scope: ReturnType<typeof effectScope> | undefined;
  let refusal: Record<string, string> | undefined;
  let closes: (UpdateOutcome | undefined)[] = [];
  const sent: Sent[] = [];

  /**
   * Opens the popup over a password change, sent through `updateSessionUser`.
   */
  const open = async (): Promise<void> => {
    const { updateSessionUser } = await import('../../../../src/dashboard/runtime/session.ts');
    scope = effectScope();
    scope.run(() => {
      currentPasswordPopup({
        submit: (currentPassword) => updateSessionUser({ password: 'new horse', currentPassword }),
        onClose: (_close, outcome) => {
          closes.push(outcome);
        },
      });
    });
    await idle();
  };

  /**
   * Types `text` into the current password input and saves.
   */
  const submit = async (text: string): Promise<void> => {
    const input = lastInput();
    input.value = text;
    fire(input, 'input');
    fire(textButton('dashboard.save'), 'click');
    await idle();
  };

  before(async () => {
    baseBrowser('/account');
    recordListeners();
    recordFetch(sent, ({ method }) => {
      if (method !== 'PATCH' || refusal === undefined) return Response.json(USER);
      const data = { errors: refusal };
      return Response.json({ statusCode: 422, message: 'Invalid', data }, { status: 422 });
    });
    ({ currentPasswordPopup } =
      await import('../../../../src/base/dashboard/components/current-password-popup.ts'));
    startSession();
  });

  beforeEach(() => {
    sent.length = 0;
    refusal = undefined;
    closes = [];
  });

  afterEach(() => {
    scope?.dispose();
    body().replaceChildren();
  });

  it('shows a refused current password under the input and stays open', async () => {
    await open();
    refusal = { currentPassword: 'Incorrect password' };
    await submit('wrong horse');
    deepStrictEqual(sent.at(-1)?.body, { password: 'new horse', currentPassword: 'wrong horse' });
    strictEqual(body().textContent.includes('Incorrect password'), true);
    deepStrictEqual(closes, []);
  });

  it('hands any other outcome to onClose', async () => {
    await open();
    refusal = { password: 'Too short' };
    await submit('correct horse');
    strictEqual(body().textContent.includes('Too short'), false);
    deepStrictEqual(
      closes.map((outcome) => outcome?.kind),
      ['invalid'],
    );
  });

  it('closes without an outcome on Cancel, sending nothing', async () => {
    await open();
    fire(textButton('dashboard.cancel'), 'click');
    deepStrictEqual(closes, [undefined]);
    strictEqual(
      sent.some(({ method }) => method === 'PATCH'),
      false,
    );
  });
});
