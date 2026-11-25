import { encodeBase64URL } from '../base64url/encode-base64url.ts';

/**
 * A P-256 key pair, both halves unpadded base64url.
 */
export interface P256Keys {
  /**
   * The uncompressed public point, 65 bytes.
   * As the VAPID key, it is the `applicationServerKey` a browser subscribes with.
   */
  publicKey: string;

  /**
   * The private scalar, 32 bytes.
   */
  privateKey: string;
}

/**
 * Generates a VAPID key pair for signing Web Push requests.
 * Generate it once and keep it: every subscription is bound to its public key.
 *
 * @example
 * ```ts
 * await generateVAPIDKeys()
 * // -> { publicKey: 'BP4z9KsN6nGR...', privateKey: 'yfWPiYE-n46H...' }
 * ```
 */
export async function generateVAPIDKeys(): Promise<P256Keys> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
  ]);
  const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const { d } = await crypto.subtle.exportKey('jwk', pair.privateKey);
  return { publicKey: encodeBase64URL(publicKey), privateKey: d! };
}
