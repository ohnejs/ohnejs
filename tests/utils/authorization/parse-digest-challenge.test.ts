import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { parseDigestChallenge } from '../../../src/utils/index.ts';

describe('parseDigestChallenge', () => {
  it('reads the RFC 7616 challenge', () => {
    deepStrictEqual(
      parseDigestChallenge(
        'Digest realm="http-auth@example.org", qop="auth, auth-int", algorithm=SHA-256, ' +
          'nonce="7ypf/xlj9XXwfDPEoM4URrv/xwf94BcCAzFZH4GiTo0v", ' +
          'opaque="FQhe/qaU925kfnzjCev0ciny7QMkPqMAFRtzCUYo5tdS"',
      ),
      {
        realm: 'http-auth@example.org',
        nonce: '7ypf/xlj9XXwfDPEoM4URrv/xwf94BcCAzFZH4GiTo0v',
        algorithm: 'SHA-256',
        qop: ['auth', 'auth-int'],
        opaque: 'FQhe/qaU925kfnzjCev0ciny7QMkPqMAFRtzCUYo5tdS',
        stale: false,
      },
    );
  });

  it('defaults the algorithm to MD5 and reads `stale`', () => {
    deepStrictEqual(parseDigestChallenge('digest realm="asterisk",nonce="1",stale=TRUE'), {
      realm: 'asterisk',
      nonce: '1',
      algorithm: 'MD5',
      qop: [],
      opaque: null,
      stale: true,
    });
  });

  it('unescapes quoted values and keeps the first of a repeated name', () => {
    const challenge = parseDigestChallenge('Digest realm="a \\"b\\", c", nonce="n", realm="z"');
    deepStrictEqual([challenge?.realm, challenge?.nonce], ['a "b", c', 'n']);
  });

  it('returns `null` for another scheme or a missing realm or nonce', () => {
    strictEqual(parseDigestChallenge('Basic realm="x"'), null);
    strictEqual(parseDigestChallenge('Digest nonce="n"'), null);
    strictEqual(parseDigestChallenge('Digest realm="r"'), null);
    strictEqual(parseDigestChallenge(''), null);
  });
});
