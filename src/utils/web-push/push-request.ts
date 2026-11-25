import type { P256Keys } from './generate-vapid-keys.ts';

import { isString } from '../is/is-string.ts';
import { encryptPush } from './_encrypt.ts';
import { vapidAuthorization } from './_vapid.ts';

/**
 * A browser's push subscription, as `PushSubscription.toJSON()` returns it.
 */
export interface WebPushSubscription {
  /**
   * The push service URL the message is posted to.
   */
  endpoint: string;

  /**
   * The browser's keys, unpadded base64url.
   */
  keys: {
    /**
     * The browser's P-256 public key.
     */
    p256dh: string;

    /**
     * The 16-byte authentication secret.
     */
    auth: string;
  };
}

/**
 * The application server's VAPID identity.
 */
export interface VAPID extends P256Keys {
  /**
   * A `mailto:` or `https:` contact the push service can reach you at.
   */
  subject: string;
}

/**
 * Delivery options for one push message.
 */
export interface PushOptions {
  /**
   * Seconds the push service keeps the message while the device is offline.
   * `0` delivers now or drops it.
   *
   * @default
   * 2419200
   */
  ttl?: number;

  /**
   * How urgently the device should wake for the message.
   * Omitted means the push service treats it as `normal`.
   */
  urgency?: 'very-low' | 'low' | 'normal' | 'high';

  /**
   * Replaces an undelivered message with the same topic.
   * At most 32 base64url characters.
   */
  topic?: string;

  /**
   * Seconds the VAPID token stays valid, at most `86400`.
   *
   * @default
   * 43200
   */
  expiresIn?: number;

  /**
   * Aborts the request.
   * Without one, `sendPush` gives up after 10 seconds.
   */
  signal?: AbortSignal;
}

/**
 * Builds the encrypted, VAPID-signed request that delivers `payload` to `subscription`.
 * `sendPush` sends it; build it yourself to send through your own `fetch`.
 * The browser picks `endpoint`, so it must be `https:`, and the request never follows a redirect.
 *
 * @example
 * ```ts
 * const request = await pushRequest(subscription, 'Site down', vapid, { urgency: 'high' })
 * request.headers.get('Urgency') // -> 'high'
 * ```
 */
export async function pushRequest(
  subscription: WebPushSubscription,
  payload: string | Uint8Array,
  vapid: VAPID,
  options: PushOptions = {},
): Promise<Request> {
  const { ttl = 2419200, urgency, topic, expiresIn = 43200, signal } = options;
  if (URL.parse(subscription.endpoint)?.protocol !== 'https:') {
    throw new Error('A push endpoint must be an https: URL');
  }
  const plaintext = isString(payload) ? new TextEncoder().encode(payload) : payload;
  const headers = new Headers({
    Authorization: await vapidAuthorization(subscription.endpoint, vapid, expiresIn),
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    TTL: String(ttl),
  });
  if (urgency) headers.set('Urgency', urgency);
  if (topic) headers.set('Topic', topic);
  const body = await encryptPush(plaintext, subscription.keys);
  return new Request(subscription.endpoint, {
    method: 'POST',
    headers,
    body,
    redirect: 'error',
    signal,
  });
}
