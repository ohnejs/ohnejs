import type { P256Keys } from './generate-vapid-keys.ts';
import type { WebPushSubscription } from './push-request.ts';

import { decodeBase64URL } from '../base64url/decode-base64url.ts';
import { concatBytes } from '../bytes/concat-bytes.ts';
import { importPrivateKey } from './_keys.ts';

const RECORD_SIZE = 4096;

const MAX_PLAINTEXT = 3993;

const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const;

const encoder = new TextEncoder();

/**
 * Encrypts `plaintext` for `keys` as one RFC 8188 `aes128gcm` record, keyed per RFC 8291.
 * `sender` and `salt` are fresh per message; pass them only to reproduce a known body.
 *
 * @example
 * ```ts
 * await encryptPush(new TextEncoder().encode('hi'), subscription.keys)
 * // -> Uint8Array: salt, record size, sender key, ciphertext
 * ```
 */
export async function encryptPush(
  plaintext: Uint8Array,
  keys: WebPushSubscription['keys'],
  sender?: P256Keys,
  salt: Uint8Array<ArrayBuffer> = crypto.getRandomValues(new Uint8Array(16)),
): Promise<Uint8Array<ArrayBuffer>> {
  if (plaintext.length > MAX_PLAINTEXT) {
    throw new Error(
      `Push payload is ${plaintext.length} bytes, over the ${MAX_PLAINTEXT} a push service takes`,
    );
  }
  const receiverPublic = decodeBase64URL(keys.p256dh);
  const receiver = await crypto.subtle.importKey('raw', receiverPublic, ECDH, false, []);
  const { publicKey, privateKey } = sender ? await importSender(sender) : await ephemeralSender();
  const secret = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: receiver },
    privateKey,
    256,
  );

  const info = concatBytes(encoder.encode('WebPush: info\0'), receiverPublic, publicKey);
  const ikm = await hkdf(decodeBase64URL(keys.auth), secret, info, 32);
  const cek = await hkdf(salt, ikm, encoder.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode('Content-Encoding: nonce\0'), 12);

  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const record = concatBytes(plaintext, new Uint8Array([2]));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, record);

  const header = new Uint8Array(21);
  header.set(salt);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = publicKey.length;
  return concatBytes(header, publicKey, new Uint8Array(ciphertext));
}

async function importSender(sender: P256Keys) {
  return {
    publicKey: decodeBase64URL(sender.publicKey),
    privateKey: await importPrivateKey(sender, 'ECDH'),
  };
}

async function ephemeralSender() {
  const pair = await crypto.subtle.generateKey(ECDH, false, ['deriveBits']);
  return {
    publicKey: new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)),
    privateKey: pair.privateKey,
  };
}

async function hkdf(
  salt: Uint8Array<ArrayBuffer>,
  ikm: ArrayBuffer,
  info: Uint8Array<ArrayBuffer>,
  length: number,
) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8);
}
