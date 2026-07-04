import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import {
  type Event,
  runWithEvent,
  setSignedCookie,
  useEnv,
  useSignedCookies,
} from '../../../src/ohne/index.ts';
import { signValue } from '../../../src/utils/crypto/index.ts';

function makeEvent(cookie?: string): Event {
  const headers = new Headers();
  if (cookie) headers.set('cookie', cookie);
  return {
    request: new Request('http://localhost/', { headers }),
    url: new URL('http://localhost/'),
    params: {},
    ip: '',
    response: { status: 200, headers: new Headers() },
    context: {},
    appliedMiddleware: [],
    waitUntil() {},
  };
}

describe('useSignedCookies', () => {
  it('recovers a validly signed cookie', () => {
    useEnv().set('COOKIE_SECRET', 'k');
    const event = makeEvent(`sid=${signValue('u42', 'k', 'sid')}`);
    deepStrictEqual(
      runWithEvent(event, () => useSignedCookies()),
      { sid: 'u42' },
    );
  });

  it('drops a tampered cookie', () => {
    useEnv().set('COOKIE_SECRET', 'k');
    const event = makeEvent('sid=u42.tampered');
    deepStrictEqual(
      runWithEvent(event, () => useSignedCookies()),
      {},
    );
  });

  it('drops a value swapped under a reused tag', () => {
    useEnv().set('COOKIE_SECRET', 'k');
    const signed = signValue('u42', 'k', 'sid');
    const tag = signed.slice(signed.indexOf('.') + 1);
    const event = makeEvent(`sid=evil.${tag}`);
    deepStrictEqual(
      runWithEvent(event, () => useSignedCookies()),
      {},
    );
  });

  it('drops a value replayed under a different name', () => {
    useEnv().set('COOKIE_SECRET', 'k');
    const event = makeEvent(`other=${signValue('u42', 'k', 'sid')}`);
    deepStrictEqual(
      runWithEvent(event, () => useSignedCookies()),
      {},
    );
  });

  it('drops an unsigned cookie', () => {
    useEnv().set('COOKIE_SECRET', 'k');
    const event = makeEvent('plain=hello');
    deepStrictEqual(
      runWithEvent(event, () => useSignedCookies()),
      {},
    );
  });

  it('round-trips through setSignedCookie and the cookie header', () => {
    useEnv().set('COOKIE_SECRET', 'k');
    const out = makeEvent();
    runWithEvent(out, () => {
      setSignedCookie('sid', 'u42');
    });
    const pair = out.response.headers.getSetCookie()[0].split(';')[0];
    const back = makeEvent(pair);
    deepStrictEqual(
      runWithEvent(back, () => useSignedCookies()),
      { sid: 'u42' },
    );
  });
});
