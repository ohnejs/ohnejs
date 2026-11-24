import { match, rejects, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import {
  type DigestChallenge,
  digestAuthorization,
  parseDigestChallenge,
} from '../../../src/utils/index.ts';

function rfc7616(algorithm: string): DigestChallenge {
  return parseDigestChallenge(
    `Digest realm="http-auth@example.org", qop="auth, auth-int", algorithm=${algorithm}, ` +
      'nonce="7ypf/xlj9XXwfDPEoM4URrv/xwf94BcCAzFZH4GiTo0v", ' +
      'opaque="FQhe/qaU925kfnzjCev0ciny7QMkPqMAFRtzCUYo5tdS"',
  )!;
}

const mufasa = {
  method: 'GET',
  uri: '/dir/index.html',
  username: 'Mufasa',
  password: 'Circle of Life',
  nc: 1,
  cnonce: 'f2/wE4q74E6zIJEtWaHKaf5wv/H5QzzpXusqGemxURZJ',
};

function response(header: string): string | undefined {
  return /response="([\da-f]+)"/.exec(header)?.[1];
}

describe('digestAuthorization', () => {
  it('matches the RFC 7616 SHA-256 example', async () => {
    const header = await digestAuthorization({ challenge: rfc7616('SHA-256'), ...mufasa });
    strictEqual(
      response(header),
      '753927fa0e85d155564e2e272a28d1802ca10daf4496794697cf8db5856cb6c1',
    );
    strictEqual(
      header,
      'Digest username="Mufasa", realm="http-auth@example.org", ' +
        'nonce="7ypf/xlj9XXwfDPEoM4URrv/xwf94BcCAzFZH4GiTo0v", uri="/dir/index.html", ' +
        'response="753927fa0e85d155564e2e272a28d1802ca10daf4496794697cf8db5856cb6c1", ' +
        'algorithm=SHA-256, cnonce="f2/wE4q74E6zIJEtWaHKaf5wv/H5QzzpXusqGemxURZJ", qop=auth, ' +
        'nc=00000001, opaque="FQhe/qaU925kfnzjCev0ciny7QMkPqMAFRtzCUYo5tdS"',
    );
  });

  it('matches the RFC 7616 MD5 example', async () => {
    const header = await digestAuthorization({ challenge: rfc7616('MD5'), ...mufasa });
    strictEqual(response(header), '8ca523f5e9506fed4657c9700eebdbec');
  });

  it('matches the RFC 2617 example', async () => {
    const challenge = parseDigestChallenge(
      'Digest realm="testrealm@host.com", qop="auth,auth-int", ' +
        'nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", opaque="5ccc069c403ebaf9f0171e9517f40e41"',
    )!;
    const header = await digestAuthorization({
      ...mufasa,
      challenge,
      password: 'Circle Of Life',
      cnonce: '0a4f113b',
    });
    strictEqual(response(header), '6629fae49393a05397450978507c4ef1');
  });

  it('answers a challenge without qop the RFC 2069 way', async () => {
    const challenge = parseDigestChallenge('Digest realm="asterisk", nonce="abc"')!;
    const header = await digestAuthorization({
      ...mufasa,
      challenge,
      method: 'REGISTER',
      uri: 'sip:x',
    });
    strictEqual(
      header,
      'Digest username="Mufasa", realm="asterisk", nonce="abc", uri="sip:x", ' +
        'response="2626b67aa4403fd625c773a5235d6336", algorithm=MD5',
    );
  });

  it('hashes the `-sess` variants with the nonces', async () => {
    const plain = await digestAuthorization({ challenge: rfc7616('SHA-256'), ...mufasa });
    const sess = await digestAuthorization({ challenge: rfc7616('SHA-256-sess'), ...mufasa });
    match(sess, /algorithm=SHA-256-SESS/);
    strictEqual(response(sess)!.length, 64);
    strictEqual(response(sess) === response(plain), false);
  });

  it('writes `nc` as 8 hex digits', async () => {
    match(
      await digestAuthorization({ challenge: rfc7616('MD5'), ...mufasa, nc: 255 }),
      /nc=000000ff/,
    );
  });

  it('throws for an unknown algorithm or an `auth-int`-only challenge', async () => {
    await rejects(digestAuthorization({ challenge: rfc7616('SHA-512-256'), ...mufasa }), {
      message: 'Unsupported digest algorithm: SHA-512-256',
    });
    const authInt = parseDigestChallenge('Digest realm="r", nonce="n", qop="auth-int"')!;
    await rejects(digestAuthorization({ challenge: authInt, ...mufasa }), {
      message: 'Unsupported digest qop: auth-int',
    });
  });
});
