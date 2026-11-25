import { deepStrictEqual, rejects, strictEqual } from 'node:assert';
import { before, describe, it, mock } from 'node:test';

import '../_fake-dom.ts';
import { createPasskey, getPasskey } from '../../../src/dashboard/runtime/passkey.ts';
import { loginWithPasskey, sessionUser } from '../../../src/dashboard/runtime/session.ts';

const USER = {
  UUID: 'u',
  email: 'a@b.c',
  roles: [],
  dashboardLanguage: null,
  contentLanguage: null,
  timezone: null,
  dateFormat: 'LL',
  timeFormat: 'LTS',
  smartClipboard: false,
};

class FakeCredential {
  toJSON() {
    return { id: 'cred', type: 'public-key', response: {} };
  }
}

let prompt: () => Promise<unknown> = async () => new FakeCredential();
const posted: Record<string, unknown>[] = [];

before(() => {
  Object.assign(document, {
    getElementById: () => ({
      textContent: JSON.stringify({
        apiURL: 'http://api',
        defaultLanguage: 'en',
        messageGroups: [],
      }),
    }),
  });
  Object.assign(globalThis, {
    PublicKeyCredential: Object.assign(FakeCredential, {
      parseRequestOptionsFromJSON: (options: unknown) => options,
      parseCreationOptionsFromJSON: (options: unknown) => options,
    }),
  });
  Object.defineProperty(globalThis.navigator, 'credentials', {
    configurable: true,
    value: { get: () => prompt(), create: () => prompt() },
  });
  mock.method(globalThis, 'fetch', async (url: string, init?: RequestInit) => {
    if (url.endsWith('/auth/passkey/options')) return Response.json({ challenge: 'c' });
    if (url.endsWith('/auth/passkey/login')) {
      posted.push(JSON.parse(init?.body as string));
      return Response.json(USER);
    }
    if (url.endsWith('/auth/me')) return new Response(null, { status: 204 });
    return Response.json({ collections: [] });
  });
});

describe('getPasskey and createPasskey', () => {
  it('answer the credential as JSON', async () => {
    prompt = async () => new FakeCredential();
    deepStrictEqual(await getPasskey({ challenge: 'c' }), new FakeCredential().toJSON());
    deepStrictEqual(await createPasskey({} as never), new FakeCredential().toJSON());
  });

  it('answer null when the user dismisses the prompt', async () => {
    prompt = async () => {
      throw new DOMException('dismissed', 'NotAllowedError');
    };
    strictEqual(await getPasskey({ challenge: 'c' }), null);
  });

  it('pass any other failure on', async () => {
    prompt = async () => {
      throw new DOMException('already registered', 'InvalidStateError');
    };
    await rejects(createPasskey({} as never), { name: 'InvalidStateError' });
  });
});

describe('loginWithPasskey', () => {
  it('reads a dismissed prompt as cancelled, sending nothing', async () => {
    prompt = async () => {
      throw new DOMException('dismissed', 'NotAllowedError');
    };
    deepStrictEqual(await loginWithPasskey(), { kind: 'cancelled' });
    deepStrictEqual(posted, []);
  });

  it('posts the credential and stores the user', async () => {
    prompt = async () => new FakeCredential();
    deepStrictEqual(await loginWithPasskey(true), { kind: 'signed-in' });
    deepStrictEqual(posted, [{ credential: new FakeCredential().toJSON(), remember: true }]);
    strictEqual(sessionUser()?.UUID, 'u');
  });
});
