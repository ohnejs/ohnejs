import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { parseSIP, sipHeader, sipHeaders } from '../../../src/utils/index.ts';

const message = parseSIP(
  [
    'SIP/2.0 401 Unauthorized',
    'v: SIP/2.0/WS a;branch=1, SIP/2.0/UDP b;branch=2',
    'Via: SIP/2.0/UDP c;branch=3',
    'Contact: "Doe, John" <sip:j@x;a=1,b>;q=0.5, <sip:k@y>',
    'WWW-Authenticate: Digest realm="a", nonce="b", qop="auth,auth-int"',
    'Proxy-Authenticate: Digest realm="c", nonce="d"',
    'Date: Sat, 13 Nov 2010 23:29:00 GMT',
    'i: abc',
    '',
    '',
  ].join('\r\n'),
)!;

describe('sipHeader', () => {
  it('finds the first value by any casing or compact name', () => {
    strictEqual(sipHeader(message, 'via'), 'SIP/2.0/WS a;branch=1');
    strictEqual(sipHeader(message, 'v'), 'SIP/2.0/WS a;branch=1');
    strictEqual(sipHeader(message, 'CALL-ID'), 'abc');
    strictEqual(sipHeader(message, 'i'), 'abc');
  });

  it('returns `undefined` for a missing header', () => {
    strictEqual(sipHeader(message, 'Expires'), undefined);
  });
});

describe('sipHeaders', () => {
  it('splits comma lists across lines in wire order', () => {
    deepStrictEqual(sipHeaders(message, 'Via'), [
      'SIP/2.0/WS a;branch=1',
      'SIP/2.0/UDP b;branch=2',
      'SIP/2.0/UDP c;branch=3',
    ]);
  });

  it('keeps commas inside quotes and angle brackets', () => {
    deepStrictEqual(sipHeaders(message, 'm'), ['"Doe, John" <sip:j@x;a=1,b>;q=0.5', '<sip:k@y>']);
  });

  it('never splits auth or free-text headers', () => {
    deepStrictEqual(sipHeaders(message, 'WWW-Authenticate'), [
      'Digest realm="a", nonce="b", qop="auth,auth-int"',
    ]);
    deepStrictEqual(sipHeaders(message, 'proxy-authenticate'), ['Digest realm="c", nonce="d"']);
    deepStrictEqual(sipHeaders(message, 'Date'), ['Sat, 13 Nov 2010 23:29:00 GMT']);
  });

  it('matches compact names in a hand-built message', () => {
    deepStrictEqual(
      sipHeaders({ status: 200, reason: 'OK', headers: [['v', 'a, b']], body: '' }, 'Via'),
      ['a', 'b'],
    );
  });
});
