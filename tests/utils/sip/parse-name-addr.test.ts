import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { formatNameAddr, parseNameAddr } from '../../../src/utils/index.ts';

describe('parseNameAddr', () => {
  it('reads a quoted display name with escapes, the URI, and parameters', () => {
    deepStrictEqual(
      parseNameAddr('"Anna \\"Anni\\" Huber" <sip:anna@example.de;transport=ws>;tag=a6c8'),
      {
        display: 'Anna "Anni" Huber',
        uri: 'sip:anna@example.de;transport=ws',
        params: { tag: 'a6c8' },
      },
    );
  });

  it('reads a token display name and a bare bracketed URI', () => {
    deepStrictEqual(parseNameAddr('Jürgen <sip:j@x>'), {
      display: 'Jürgen',
      uri: 'sip:j@x',
      params: {},
    });
    deepStrictEqual(parseNameAddr(' <sip:j@x> '), { display: null, uri: 'sip:j@x', params: {} });
  });

  it('reads parameters of a bare `addr-spec` as header parameters', () => {
    deepStrictEqual(parseNameAddr('sip:owner@127.0.0.1;expires=600;+sip.instance="<urn:uuid:1>"'), {
      display: null,
      uri: 'sip:owner@127.0.0.1',
      params: { expires: '600', '+sip.instance': '<urn:uuid:1>' },
    });
  });

  it('returns `null` for an unclosed quote or bracket, or an empty URI', () => {
    strictEqual(parseNameAddr('"Anna <sip:a@b>'), null);
    strictEqual(parseNameAddr('Anna <sip:a@b'), null);
    strictEqual(parseNameAddr('<>'), null);
    strictEqual(parseNameAddr('"Anna" sip:a@b'), null);
    strictEqual(parseNameAddr(''), null);
  });
});

describe('formatNameAddr', () => {
  it('quotes the display name and non-token values, and writes flags bare', () => {
    strictEqual(
      formatNameAddr({
        display: 'Say "hi"',
        uri: 'sip:owner@x',
        params: { '+sip.instance': '<urn:uuid:1>', ob: '', expires: '600' },
      }),
      '"Say \\"hi\\"" <sip:owner@x>;+sip.instance="<urn:uuid:1>";ob;expires=600',
    );
  });

  it('round-trips through `parseNameAddr`', () => {
    const addr = {
      display: 'Müller, Jürgen',
      uri: 'sip:+49891@x',
      params: { tag: '9f', q: '0.5' },
    };
    deepStrictEqual(parseNameAddr(formatNameAddr(addr)), addr);
  });
});
