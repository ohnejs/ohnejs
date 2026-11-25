import {
  pushRequest,
  type PushOptions,
  type VAPID,
  type WebPushSubscription,
} from './push-request.ts';

/**
 * Sends `payload` to `subscription` as an encrypted Web Push message, signed with `vapid`.
 * The push service answers `201` once it accepts the message.
 * A `404` or `410` means the subscription is gone: delete it.
 *
 * @example
 * ```ts
 * const response = await sendPush(subscription, JSON.stringify({ title: 'Site down' }), vapid, { ttl: 3600 })
 * response.status // -> 201
 * ```
 */
export async function sendPush(
  subscription: WebPushSubscription,
  payload: string | Uint8Array,
  vapid: VAPID,
  options: PushOptions = {},
): Promise<Response> {
  const signal = options.signal ?? AbortSignal.timeout(10_000);
  return fetch(await pushRequest(subscription, payload, vapid, { ...options, signal }));
}
