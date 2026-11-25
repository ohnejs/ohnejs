import type { VAPID } from './push-request.ts';

import { encodeBase64URL } from '../base64url/encode-base64url.ts';
import { importPrivateKey } from './_keys.ts';

const MAX_EXPIRES_IN = 86400;

const encoder = new TextEncoder();

const HEADER = encodeBase64URL(encoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));

/**
 * Builds the RFC 8292 `Authorization` header for a push to `endpoint`.
 * The ES256 token is audienced to the endpoint origin and expires `expiresIn` seconds from now.
 *
 * @example
 * ```ts
 * await vapidAuthorization('https://push.example.net/abc', vapid, 43200)
 * // -> 'vapid t=eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9...., k=BP4z9KsN6nGR...'
 * ```
 */
export async function vapidAuthorization(
  endpoint: string,
  vapid: VAPID,
  expiresIn: number,
): Promise<string> {
  if (expiresIn > MAX_EXPIRES_IN) {
    throw new Error(
      `VAPID \`expiresIn\` is ${expiresIn} seconds, over the ${MAX_EXPIRES_IN} allowed`,
    );
  }
  const claims = {
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + expiresIn,
    sub: vapid.subject,
  };
  const body = `${HEADER}.${encodeBase64URL(encoder.encode(JSON.stringify(claims)))}`;
  const key = await importPrivateKey(vapid, 'ECDSA');
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    encoder.encode(body),
  );
  return `vapid t=${body}.${encodeBase64URL(new Uint8Array(signature))}, k=${vapid.publicKey}`;
}
