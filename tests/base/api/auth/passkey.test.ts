import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { createPublicKey } from 'node:crypto';
import { describe, it } from 'node:test';

import type {
  CredentialRejection,
  Passkey,
  SignIn,
  User,
} from '../../../../src/base/auth/types.ts';
import type { AnyHandler, Route } from '../../../../src/ohne/routes/route.ts';

import loginHandler from '../../../../src/base/api/auth/login.post.ts';
import methodsHandler from '../../../../src/base/api/auth/methods.get.ts';
import deleteHandler from '../../../../src/base/api/auth/passkey/[uuid].delete.ts';
import renameHandler from '../../../../src/base/api/auth/passkey/[uuid].patch.ts';
import listHandler from '../../../../src/base/api/auth/passkey/index.get.ts';
import passkeyLoginHandler from '../../../../src/base/api/auth/passkey/login.post.ts';
import optionsHandler from '../../../../src/base/api/auth/passkey/options.post.ts';
import registerHandler from '../../../../src/base/api/auth/passkey/register.post.ts';
import registerOptionsHandler from '../../../../src/base/api/auth/passkey/register/options.post.ts';
import reauthHandler from '../../../../src/base/api/auth/reauth.post.ts';
import PasskeysCollection from '../../../../src/base/collections/Passkeys.ts';
import SessionsCollection from '../../../../src/base/collections/Sessions.ts';
import UsersCollection from '../../../../src/base/collections/Users.ts';
import datePatternField from '../../../../src/base/fields/date-pattern.ts';
import languageField from '../../../../src/base/fields/language.ts';
import localeField from '../../../../src/base/fields/locale.ts';
import passwordField from '../../../../src/base/fields/password.ts';
import rolesField from '../../../../src/base/fields/roles.ts';
import timezoneField from '../../../../src/base/fields/timezone.ts';
import { useCollections } from '../../../../src/ohne/collections/use-collections.ts';
import { buildDesiredSchema } from '../../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../../src/ohne/database/schema/sync.ts';
import { registerDatabase, registerDialect } from '../../../../src/ohne/database/use-database.ts';
import { useEnv } from '../../../../src/ohne/env/use-env.ts';
import { useFields } from '../../../../src/ohne/fields/use-fields.ts';
import { hook } from '../../../../src/ohne/hooks/hook.ts';
import { dispatch } from '../../../../src/ohne/http/dispatch.ts';
import { DEFAULTS } from '../../../../src/ohne/layers/config.ts';
import { useLayers } from '../../../../src/ohne/layers/use-layers.ts';
import { usePrinter } from '../../../../src/ohne/printer/use-printer.ts';
import { queryUntyped } from '../../../../src/ohne/query/query.ts';
import { connectTest, dialect } from '../../../_dialect.ts';
import { FLAG, fakePasskey } from '../../../utils/webauthn/_authenticator.ts';

usePrinter().configure({ stream: { write: () => true } });
useEnv().set('COOKIE_SECRET', 'passkey-test-secret');

const LAYER = '/passkey-test';
const PASSKEYS = { rpID: 'example.com', origin: 'https://example.com' };

/**
 * Configures the app's `auth`, with passkeys on and a cheap scrypt cost unless `auth` says otherwise.
 */
function configure(auth: Record<string, unknown> = {}): void {
  useLayers().remove(LAYER);
  useLayers().add({
    path: LAYER,
    defaults: DEFAULTS,
    input: { auth: { passkeys: PASSKEYS, password: { cost: 1024 }, ...auth } },
  });
}

configure();

useFields().register('password', { name: 'password', fieldType: passwordField });
useFields().register('roles', { name: 'roles', fieldType: rolesField });
useFields().register('language', { name: 'language', fieldType: languageField });
useFields().register('locale', { name: 'locale', fieldType: localeField });
useFields().register('timezone', { name: 'timezone', fieldType: timezoneField });
useFields().register('datePattern', { name: 'datePattern', fieldType: datePatternField });
useCollections().register('Users', { name: 'Users', collection: UsersCollection });
useCollections().register('Sessions', { name: 'Sessions', collection: SessionsCollection });
useCollections().register('Passkeys', { name: 'Passkeys', collection: PasskeysCollection });

const db = await connectTest();
registerDialect(dialect);
registerDatabase(db);
await syncDatabase(db, dialect, {
  desired: buildDesiredSchema(useCollections(), useFields() as never),
});

const signIns: SignIn[] = [];
const rejections: CredentialRejection[] = [];
let refuseSignIn = false;
hook('auth:signed-in', (signIn) => {
  if (refuseSignIn) throw new Error('banned');
  signIns.push(signIn);
});
hook('auth:credential-rejected', (rejection) => void rejections.push(rejection));

function route(method: string, pattern: string, handler: unknown): Route {
  return {
    method: method as Route['method'],
    pattern,
    file: `${pattern}.ts`,
    layer: 'ohnejs/base',
    handler: handler as AnyHandler,
  };
}

const ROUTES = {
  login: route('POST', '/auth/login', loginHandler),
  methods: route('GET', '/auth/methods', methodsHandler),
  options: route('POST', '/auth/passkey/options', optionsHandler),
  passkeyLogin: route('POST', '/auth/passkey/login', passkeyLoginHandler),
  registerOptions: route('POST', '/auth/passkey/register/options', registerOptionsHandler),
  register: route('POST', '/auth/passkey/register', registerHandler),
  list: route('GET', '/auth/passkey', listHandler),
  rename: route('PATCH', '/auth/passkey/[uuid]', renameHandler),
  remove: route('DELETE', '/auth/passkey/[uuid]', deleteHandler),
  reauth: route('POST', '/auth/reauth', reauthHandler),
};

/**
 * A browser's cookie jar: it sends what it holds and keeps what each answer sets.
 */
class Browser {
  cookies = new Map<string, string>();

  async call(r: Route, json?: unknown, params: Record<string, string> = {}): Promise<Response> {
    const headers = new Headers();
    if (json !== undefined) headers.set('Content-Type', 'application/json');
    if (this.cookies.size > 0) {
      headers.set(
        'Cookie',
        [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; '),
      );
    }
    const request = new Request(`http://localhost${r.pattern}`, {
      method: r.method ?? undefined,
      headers,
      body: json === undefined ? undefined : JSON.stringify(json),
    });
    const { response } = await dispatch(r, request, new URL(request.url), params);
    for (const header of response.headers.getSetCookie()) {
      const [pair] = header.split(';', 1);
      const [name, value] = [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)];
      if (value === '' || /Max-Age=0/.test(header)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    return response;
  }

  async challenge(r: Route = ROUTES.options): Promise<string> {
    const response = await this.call(r);
    strictEqual(response.status, 200);
    return ((await response.json()) as { challenge: string }).challenge;
  }
}

let counter = 0;

/**
 * A signed-in browser for a new user, with a passkey registered on `authenticator`.
 */
async function enrolled(authenticator = fakePasskey()) {
  const email = `user-${++counter}@example.com`;
  const user = await queryUntyped('Users').createOrThrow({ email, password: 'correct horse' });
  const browser = new Browser();
  strictEqual((await browser.call(ROUTES.login, { email, password: 'correct horse' })).status, 200);
  const challenge = await browser.challenge(ROUTES.registerOptions);
  const registered = await browser.call(ROUTES.register, {
    credential: authenticator.register(challenge),
    name: 'iPhone',
  });
  strictEqual(registered.status, 200);
  const passkey = (await registered.json()) as Passkey;
  return { browser, authenticator, email, user: user.UUID as string, passkey };
}

/**
 * Stores `authenticator` as a new user's passkey directly, whatever origin and RP ID it answers for.
 */
async function seeded(authenticator: ReturnType<typeof fakePasskey>) {
  const user = await queryUntyped('Users').createOrThrow({
    email: `seeded-${++counter}@example.com`,
    password: 'correct horse',
  });
  const { kty, crv, x, y } = createPublicKey(authenticator.privateKey).export({ format: 'jwk' });
  await queryUntyped('Passkeys').createOrThrow({
    user: user.UUID,
    name: 'Seeded',
    credentialID: authenticator.id,
    publicKey: { kty, crv, alg: 'ES256', x, y },
    createdAt: Date.now(),
  });
  return authenticator;
}

/**
 * Ages the browser's session past the re-auth window.
 */
async function stale(user: string): Promise<void> {
  await queryUntyped('Sessions')
    .unscoped()
    .where({ user })
    .update({ verifiedAt: Date.now() - 6 * 60_000 });
}

describe('GET /auth/methods', () => {
  it('names the sign-in methods the app offers', async () => {
    deepStrictEqual(await (await new Browser().call(ROUTES.methods)).json(), {
      password: true,
      passkeys: true,
    });
  });
});

describe('POST /auth/passkey/login', () => {
  it('signs in with a synced passkey, as both factors, and records its use', async () => {
    const { authenticator, user, passkey } = await enrolled();
    const browser = new Browser();
    const options = await browser.call(ROUTES.options);
    const { challenge, rpId, userVerification } = (await options.json()) as Record<string, string>;
    deepStrictEqual([rpId, userVerification], ['example.com', 'required']);
    ok(browser.cookies.has('ohne-passkey'));

    signIns.length = 0;
    const response = await browser.call(ROUTES.passkeyLogin, {
      credential: authenticator.authenticate(challenge),
    });
    strictEqual(response.status, 200);
    strictEqual(((await response.json()) as User).UUID, user);
    ok(browser.cookies.has('session'));
    ok(!browser.cookies.has('ohne-passkey'));
    deepStrictEqual(
      signIns.map(({ method, multiFactor, user: who }) => ({ method, multiFactor, who })),
      [{ method: 'passkey', multiFactor: true, who: user }],
    );

    const [listed] = (await (await browser.call(ROUTES.list)).json()) as Passkey[];
    strictEqual(listed.UUID, passkey.UUID);
    ok(listed.lastUsedAt !== null && listed.synced);
  });

  it('refuses a replayed challenge and assertion', async () => {
    const { authenticator } = await enrolled();
    const browser = new Browser();
    const challenge = await browser.challenge();
    const cookies = new Map(browser.cookies);
    const credential = authenticator.authenticate(challenge);
    strictEqual((await browser.call(ROUTES.passkeyLogin, { credential })).status, 200);

    const replay = new Browser();
    replay.cookies = cookies;
    strictEqual((await replay.call(ROUTES.passkeyLogin, { credential })).status, 401);
  });

  it('refuses a tampered challenge cookie', async () => {
    const { authenticator } = await enrolled();
    const browser = new Browser();
    await browser.challenge();
    const forged = 'forged-challenge';
    const signed = browser.cookies.get('ohne-passkey') as string;
    const [ceremony, , expiresAt, user] = signed.slice(0, signed.lastIndexOf('.')).split(':');
    browser.cookies.set(
      'ohne-passkey',
      `${[ceremony, forged, expiresAt, user].join(':')}${signed.slice(signed.lastIndexOf('.'))}`,
    );
    const response = await browser.call(ROUTES.passkeyLogin, {
      credential: authenticator.authenticate(forged),
    });
    strictEqual(response.status, 401);
  });

  it('refuses a challenge without its cookie', async () => {
    const { authenticator } = await enrolled();
    const browser = new Browser();
    const challenge = await browser.challenge();
    browser.cookies.clear();
    const credential = authenticator.authenticate(challenge);
    strictEqual((await browser.call(ROUTES.passkeyLogin, { credential })).status, 401);
  });

  it('refuses an assertion from another origin', async () => {
    const phished = await seeded(fakePasskey('example.com', 'https://examp1e.com'));
    const browser = new Browser();
    const credential = phished.authenticate(await browser.challenge());
    strictEqual((await browser.call(ROUTES.passkeyLogin, { credential })).status, 401);
  });

  it('refuses an assertion for another RP ID', async () => {
    const other = await seeded(fakePasskey('examp1e.com', 'https://example.com'));
    const browser = new Browser();
    const credential = other.authenticate(await browser.challenge());
    strictEqual((await browser.call(ROUTES.passkeyLogin, { credential })).status, 401);
  });

  it('accepts a seeded passkey from the right origin and RP ID', async () => {
    const own = await seeded(fakePasskey());
    const browser = new Browser();
    const credential = own.authenticate(await browser.challenge());
    strictEqual((await browser.call(ROUTES.passkeyLogin, { credential })).status, 200);
  });

  it('refuses an assertion without user verification', async () => {
    const { authenticator } = await enrolled();
    const browser = new Browser();
    const challenge = await browser.challenge();
    const credential = authenticator.authenticate(challenge, { flags: FLAG.UP });
    strictEqual((await browser.call(ROUTES.passkeyLogin, { credential })).status, 401);
  });

  it('refuses a counter that goes back, as from a cloned key', async () => {
    const { authenticator } = await enrolled();
    const flags = FLAG.UP | FLAG.UV;
    const first = new Browser();
    const ahead = authenticator.authenticate(await first.challenge(), { flags, signCount: 7 });
    strictEqual((await first.call(ROUTES.passkeyLogin, { credential: ahead })).status, 200);

    const second = new Browser();
    const behind = authenticator.authenticate(await second.challenge(), { flags, signCount: 3 });
    strictEqual((await second.call(ROUTES.passkeyLogin, { credential: behind })).status, 401);
  });

  it('refuses an unknown passkey and reports it', async () => {
    const browser = new Browser();
    const challenge = await browser.challenge();
    rejections.length = 0;
    const credential = fakePasskey().authenticate(challenge);
    strictEqual((await browser.call(ROUTES.passkeyLogin, { credential })).status, 401);
    deepStrictEqual(rejections, [{ method: 'passkey', user: undefined }]);
  });

  it('refuses a registration challenge', async () => {
    const { browser, authenticator } = await enrolled();
    const challenge = await browser.challenge(ROUTES.registerOptions);
    const credential = authenticator.authenticate(challenge);
    strictEqual((await browser.call(ROUTES.passkeyLogin, { credential })).status, 401);
  });

  it('answers 400 to a body without a credential', async () => {
    strictEqual((await new Browser().call(ROUTES.passkeyLogin, { credential: 'x' })).status, 400);
  });
});

describe('POST /auth/login', () => {
  it('reports a wrong password and a sign-in', async () => {
    const { email, user } = await enrolled();
    rejections.length = 0;
    signIns.length = 0;
    const browser = new Browser();
    strictEqual((await browser.call(ROUTES.login, { email, password: 'nope' })).status, 401);
    strictEqual(
      (await browser.call(ROUTES.login, { email: 'ghost@x.org', password: 'n' })).status,
      401,
    );
    deepStrictEqual(rejections, [
      { method: 'password', email, user },
      { method: 'password', email: 'ghost@x.org' },
    ]);
    strictEqual(
      (await browser.call(ROUTES.login, { email, password: 'correct horse' })).status,
      200,
    );
    deepStrictEqual(
      signIns.map(({ method, multiFactor }) => ({ method, multiFactor })),
      [{ method: 'password', multiFactor: false }],
    );
  });
  it('refuses a sign-in the `auth:signed-in` hook throws for, leaving no session', async () => {
    const { email, user } = await enrolled();
    await queryUntyped('Sessions').unscoped().where({ user }).delete();
    const browser = new Browser();
    refuseSignIn = true;
    const response = await browser
      .call(ROUTES.login, { email, password: 'correct horse' })
      .finally(() => (refuseSignIn = false));
    strictEqual(response.status, 500);
    ok(!browser.cookies.has('session'));
    strictEqual(await queryUntyped('Sessions').unscoped().where({ user }).exists(), false);
  });
});

describe('POST /auth/passkey/register', () => {
  it('lists the new passkey and excludes it from the next registration', async () => {
    const { browser, authenticator, passkey } = await enrolled();
    deepStrictEqual(
      { name: passkey.name, synced: passkey.synced, lastUsedAt: passkey.lastUsedAt },
      { name: 'iPhone', synced: true, lastUsedAt: null },
    );
    const options = (await (await browser.call(ROUTES.registerOptions)).json()) as {
      excludeCredentials: { id: string }[];
      authenticatorSelection: Record<string, unknown>;
      attestation: string;
    };
    deepStrictEqual(
      options.excludeCredentials.map(({ id }) => id),
      [authenticator.id],
    );
    deepStrictEqual(
      [options.attestation, options.authenticatorSelection.userVerification],
      ['none', 'required'],
    );
  });

  it('asks a stale session to confirm first', async () => {
    const { browser, user } = await enrolled();
    await stale(user);
    const response = await browser.call(ROUTES.registerOptions);
    strictEqual(response.status, 403);
    deepStrictEqual(((await response.json()) as { data: unknown }).data, {
      reauth: true,
      passkey: true,
    });
  });

  it('answers 401 when signed out', async () => {
    strictEqual((await new Browser().call(ROUTES.registerOptions)).status, 401);
  });

  it('refuses a challenge issued to another user', async () => {
    const alice = await enrolled();
    const bob = await enrolled();
    const challenge = await alice.browser.challenge(ROUTES.registerOptions);
    bob.browser.cookies.set('ohne-passkey', alice.browser.cookies.get('ohne-passkey') as string);
    const credential = fakePasskey().register(challenge);
    strictEqual((await bob.browser.call(ROUTES.register, { credential })).status, 401);
  });

  it('refuses a replayed registration', async () => {
    const { browser } = await enrolled();
    const challenge = await browser.challenge(ROUTES.registerOptions);
    const cookies = new Map(browser.cookies);
    const credential = fakePasskey().register(challenge);
    strictEqual((await browser.call(ROUTES.register, { credential })).status, 200);
    browser.cookies = new Map([...browser.cookies, ...cookies]);
    strictEqual((await browser.call(ROUTES.register, { credential })).status, 401);
  });

  it('refuses a passkey without user verification', async () => {
    const { browser } = await enrolled();
    const challenge = await browser.challenge(ROUTES.registerOptions);
    const credential = fakePasskey().register(challenge, { flags: FLAG.UP | FLAG.AT });
    strictEqual((await browser.call(ROUTES.register, { credential })).status, 401);
  });

  it('refuses a registration from another origin', async () => {
    const { browser } = await enrolled();
    const challenge = await browser.challenge(ROUTES.registerOptions);
    const credential = fakePasskey('example.com', 'https://examp1e.com').register(challenge);
    strictEqual((await browser.call(ROUTES.register, { credential })).status, 401);
  });
});

describe('POST /auth/reauth', () => {
  it('confirms with the password, refusing a wrong one', async () => {
    const { browser, user } = await enrolled();
    await stale(user);
    rejections.length = 0;
    const wrong = await browser.call(ROUTES.reauth, { password: 'nope' });
    strictEqual(wrong.status, 422);
    deepStrictEqual(rejections, [{ method: 'password', user }]);
    strictEqual((await browser.call(ROUTES.registerOptions)).status, 403);

    strictEqual((await browser.call(ROUTES.reauth, { password: 'correct horse' })).status, 200);
    strictEqual((await browser.call(ROUTES.registerOptions)).status, 200);
  });

  it('confirms with the user’s own passkey only', async () => {
    const alice = await enrolled();
    const bob = await enrolled();
    await stale(alice.user);

    const options = (await (await alice.browser.call(ROUTES.options)).json()) as {
      challenge: string;
      allowCredentials: { id: string }[];
    };
    deepStrictEqual(
      options.allowCredentials.map(({ id }) => id),
      [alice.authenticator.id],
    );
    const foreign = bob.authenticator.authenticate(options.challenge);
    strictEqual((await alice.browser.call(ROUTES.reauth, { credential: foreign })).status, 401);

    const challenge = await alice.browser.challenge();
    const own = alice.authenticator.authenticate(challenge);
    strictEqual((await alice.browser.call(ROUTES.reauth, { credential: own })).status, 200);
    strictEqual((await alice.browser.call(ROUTES.registerOptions)).status, 200);
  });

  it('answers 400 to a body with neither', async () => {
    const { browser } = await enrolled();
    strictEqual((await browser.call(ROUTES.reauth, {})).status, 400);
  });
});

describe('PATCH and DELETE /auth/passkey/[uuid]', () => {
  it('renames and removes an own passkey once confirmed', async () => {
    const { browser, user, passkey } = await enrolled();
    const params = { uuid: passkey.UUID };
    await stale(user);
    strictEqual((await browser.call(ROUTES.rename, { name: 'Mac' }, params)).status, 403);
    strictEqual((await browser.call(ROUTES.remove, undefined, params)).status, 403);

    strictEqual((await browser.call(ROUTES.reauth, { password: 'correct horse' })).status, 200);
    const renamed = await browser.call(ROUTES.rename, { name: ' Mac ' }, params);
    strictEqual(((await renamed.json()) as Passkey).name, 'Mac');
    strictEqual((await browser.call(ROUTES.rename, { name: ' ' }, params)).status, 400);
    strictEqual((await browser.call(ROUTES.remove, undefined, params)).status, 204);
    deepStrictEqual(await (await browser.call(ROUTES.list)).json(), []);
  });

  it('answers 404 for another user’s passkey', async () => {
    const alice = await enrolled();
    const bob = await enrolled();
    const params = { uuid: alice.passkey.UUID };
    strictEqual((await bob.browser.call(ROUTES.rename, { name: 'Mine' }, params)).status, 404);
    strictEqual((await bob.browser.call(ROUTES.remove, undefined, params)).status, 404);
    strictEqual(((await (await alice.browser.call(ROUTES.list)).json()) as Passkey[]).length, 1);
  });
});

describe('passkey-only sign-in', () => {
  it('turns password sign-in off, keeping the last passkey', async () => {
    const { browser, email, passkey } = await enrolled();
    configure({ password: false });
    try {
      deepStrictEqual(await (await browser.call(ROUTES.methods)).json(), {
        password: false,
        passkeys: true,
      });
      const login = await new Browser().call(ROUTES.login, { email, password: 'correct horse' });
      strictEqual(login.status, 404);
      strictEqual((await browser.call(ROUTES.reauth, { password: 'correct horse' })).status, 400);
      const removed = await browser.call(ROUTES.remove, undefined, { uuid: passkey.UUID });
      strictEqual(removed.status, 409);
      strictEqual(((await browser.call(ROUTES.list).then((r) => r.json())) as []).length, 1);
    } finally {
      configure();
    }
  });

  it('lets a user without a passkey add the first one without confirming', async () => {
    const email = `first-${++counter}@example.com`;
    const user = await queryUntyped('Users').createOrThrow({ email, password: 'correct horse' });
    const browser = new Browser();
    strictEqual(
      (await browser.call(ROUTES.login, { email, password: 'correct horse' })).status,
      200,
    );
    await stale(user.UUID as string);
    configure({ password: false });
    try {
      const challenge = await browser.challenge(ROUTES.registerOptions);
      const credential = fakePasskey().register(challenge);
      strictEqual((await browser.call(ROUTES.register, { credential })).status, 200);
      strictEqual((await browser.call(ROUTES.registerOptions)).status, 403);
    } finally {
      configure();
    }
  });
});

describe('a user without a password', () => {
  it('is refused a password like a wrong one, and confirms with a passkey', async () => {
    const { browser, authenticator, email, user } = await enrolled();
    const other = await enrolled();
    await queryUntyped('Users').where({ UUID: user }).updateOrThrow({ password: null });
    rejections.length = 0;

    const none = await new Browser().call(ROUTES.login, { email, password: 'correct horse' });
    const wrong = await new Browser().call(ROUTES.login, { email: other.email, password: 'nope' });
    strictEqual(none.status, 401);
    deepStrictEqual(await none.json(), await wrong.json());

    await stale(user);
    strictEqual((await browser.call(ROUTES.reauth, { password: 'correct horse' })).status, 422);
    deepStrictEqual(rejections, [
      { method: 'password', email, user },
      { method: 'password', email: other.email, user: other.user },
      { method: 'password', user },
    ]);
    const credential = authenticator.authenticate(await browser.challenge());
    strictEqual((await browser.call(ROUTES.reauth, { credential })).status, 200);
  });
});

describe('passkeys off', () => {
  it('answers 404 on every passkey route', async () => {
    const { browser } = await enrolled();
    configure({ passkeys: false });
    try {
      for (const r of [ROUTES.options, ROUTES.passkeyLogin, ROUTES.registerOptions, ROUTES.list]) {
        strictEqual((await browser.call(r, r.method === 'GET' ? undefined : {})).status, 404);
      }
      deepStrictEqual(await (await browser.call(ROUTES.methods)).json(), {
        password: true,
        passkeys: false,
      });
    } finally {
      configure();
    }
  });
});
