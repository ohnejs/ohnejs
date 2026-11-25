import { deepStrictEqual, strictEqual } from 'node:assert';
import { before, describe, it } from 'node:test';

import type { Sent } from '../../base/dashboard/components/_popups.ts';

import { startSession } from '../../../src/dashboard/runtime/_request.ts';
import { api } from '../../../src/dashboard/runtime/api.ts';
import { baseBrowser } from '../../base/dashboard/_browser.ts';
import {
  body,
  fire,
  idle,
  lastInput,
  recordFetch,
  recordListeners,
  textButton,
} from '../../base/dashboard/components/_popups.ts';

describe('withReauth', () => {
  let withReauth!: typeof import('../../../src/dashboard/ui/reauth.ts').withReauth;
  const sent: Sent[] = [];
  let confirmed = false;

  /**
   * Types `text` into the password input and confirms.
   */
  const confirm = async (text: string): Promise<void> => {
    const input = lastInput();
    input.value = text;
    fire(input, 'input');
    fire(textButton('dashboard.account.confirm'), 'click');
    await idle();
  };

  before(async () => {
    baseBrowser('/account');
    recordListeners();
    recordFetch(sent, ({ path, body: json }) => {
      if (path === '/auth/reauth') {
        confirmed = (json as { password: string }).password === 'correct horse';
        if (confirmed) return Response.json({ ok: true });
        const data = { errors: { password: 'Incorrect password' } };
        return Response.json({ statusCode: 422, message: 'Invalid', data }, { status: 422 });
      }
      if (!confirmed) {
        const data = { reauth: true, passkey: false };
        return Response.json({ statusCode: 403, data }, { status: 403 });
      }
      return Response.json({ renamed: true });
    });
    ({ withReauth } = await import('../../../src/dashboard/ui/reauth.ts'));
    startSession();
  });

  it('asks for the password, keeps a wrong one open, and resends once confirmed', async () => {
    const answer = withReauth(() => api('PATCH /auth/passkey/p'));
    await idle();
    await confirm('wrong horse');
    strictEqual(body().textContent.includes('Incorrect password'), true);
    await confirm('correct horse');
    deepStrictEqual(await (await (answer as Promise<Response>)).json(), { renamed: true });
    deepStrictEqual(
      sent.map(({ method, path }) => `${method} ${path}`).filter((id) => id.startsWith('P')),
      ['PATCH /auth/passkey/p', 'POST /auth/reauth', 'POST /auth/reauth', 'PATCH /auth/passkey/p'],
    );
  });

  it('passes an answer that does not ask to confirm straight through', async () => {
    sent.length = 0;
    const answer = await withReauth(() => api('PATCH /auth/passkey/p'));
    strictEqual(answer?.status, 200);
    strictEqual(sent.length, 1);
  });
});
