import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { parseSIPURI } from '../../../src/utils/index.ts';

describe('parseSIPURI', () => {
  it('reads user, host, port, and parameters', () => {
    deepStrictEqual(parseSIPURI('sip:owner@127.0.0.1:8088;transport=ws;lr'), {
      scheme: 'sip',
      user: 'owner',
      host: '127.0.0.1',
      port: 8088,
      params: { transport: 'ws', lr: '' },
    });
  });

  it('percent-decodes the user, drops a password and headers, and lowercases the scheme', () => {
    deepStrictEqual(parseSIPURI('SIPS:%2B49%2089:secret@voip.example.de?subject=x'), {
      scheme: 'sips',
      user: '+49 89',
      host: 'voip.example.de',
      port: null,
      params: {},
    });
  });

  it('reads a host-only URI and an IPv6 reference', () => {
    deepStrictEqual(parseSIPURI('sip:[2001:db8::1]:5061'), {
      scheme: 'sip',
      user: null,
      host: '[2001:db8::1]',
      port: 5061,
      params: {},
    });
  });

  it('returns `null` for another scheme, an empty host, a bad port, or a bad escape', () => {
    strictEqual(parseSIPURI('tel:+4989123'), null);
    strictEqual(parseSIPURI('sipx:a@b'), null);
    strictEqual(parseSIPURI('sip:a@'), null);
    strictEqual(parseSIPURI('sip:a@b:70000'), null);
    strictEqual(parseSIPURI('sip:%E0%A4%A@b'), null);
  });
});
