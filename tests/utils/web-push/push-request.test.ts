import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert';
import { createPublicKey, verify } from 'node:crypto';
import { describe, it } from 'node:test';

import { generateVAPIDKeys, pushRequest } from '../../../src/utils/index.ts';

const subscription = {
  endpoint: 'https://push.example.net:8443/wpush/v2/abc?x=1',
  keys: {
    p256dh:
      'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  },
};

const vapid = { ...(await generateVAPIDKeys()), subject: 'mailto:ops@example.net' };

const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString());

function parseAuthorization(header: string) {
  const match = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(header);
  ok(match, header);
  const [, head, claims, signature, key] = match;
  return { head: head!, claims: claims!, signature: signature!, key: key! };
}

describe('pushRequest', () => {
  it('posts an aes128gcm body to the endpoint', async () => {
    const request = await pushRequest(subscription, 'hi', vapid);
    strictEqual(request.method, 'POST');
    strictEqual(request.url, subscription.endpoint);
    strictEqual(request.headers.get('Content-Encoding'), 'aes128gcm');
    strictEqual(request.headers.get('Content-Type'), 'application/octet-stream');
    strictEqual((await request.bytes()).length, 86 + 2 + 17);
  });

  it('refuses a non-https endpoint and never follows a redirect', async () => {
    const plain = { ...subscription, endpoint: 'http://127.0.0.1/push' };
    await rejects(pushRequest(plain, 'hi', vapid), /https:/);
    strictEqual((await pushRequest(subscription, 'hi', vapid)).redirect, 'error');
  });

  it('sets TTL, and Urgency and Topic only when given', async () => {
    const plain = await pushRequest(subscription, 'hi', vapid);
    strictEqual(plain.headers.get('TTL'), '2419200');
    strictEqual(plain.headers.has('Urgency'), false);
    strictEqual(plain.headers.has('Topic'), false);

    const tuned = await pushRequest(subscription, 'hi', vapid, {
      ttl: 0,
      urgency: 'high',
      topic: 'site-down',
    });
    strictEqual(tuned.headers.get('TTL'), '0');
    strictEqual(tuned.headers.get('Urgency'), 'high');
    strictEqual(tuned.headers.get('Topic'), 'site-down');
  });

  it('signs an ES256 VAPID token over the endpoint origin', async () => {
    const request = await pushRequest(subscription, new Uint8Array([1]), vapid);
    const { head, claims, signature, key } = parseAuthorization(
      request.headers.get('Authorization')!,
    );
    strictEqual(key, vapid.publicKey);
    deepStrictEqual(decode(head), { typ: 'JWT', alg: 'ES256' });

    const { aud, exp, sub } = decode(claims);
    strictEqual(aud, 'https://push.example.net:8443');
    strictEqual(sub, 'mailto:ops@example.net');
    ok(Math.abs(exp - (Date.now() / 1000 + 43200)) < 5);

    const point = Buffer.from(key, 'base64url');
    const publicKey = createPublicKey({
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: point.subarray(1, 33).toString('base64url'),
        y: point.subarray(33).toString('base64url'),
      },
      format: 'jwk',
    });
    const signed = Buffer.from(`${head}.${claims}`);
    const raw = Buffer.from(signature, 'base64url');
    strictEqual(raw.length, 64);
    ok(verify('sha256', signed, { key: publicKey, dsaEncoding: 'ieee-p1363' }, raw));
  });

  it('takes a VAPID lifetime of up to a day', async () => {
    const request = await pushRequest(subscription, 'hi', vapid, { expiresIn: 86400 });
    const { exp } = decode(parseAuthorization(request.headers.get('Authorization')!).claims);
    ok(exp <= Math.ceil(Date.now() / 1000) + 86400);
    await rejects(pushRequest(subscription, 'hi', vapid, { expiresIn: 86401 }), /86401 seconds/);
  });
});
