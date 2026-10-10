import type { UncheckedMessage } from '../messages/known-messages.ts';

/**
 * A parameterized `validation.*` failure as its `{ key, params }` message object.
 * The keys live in the `ohnejs/base` catalog, which an app can disable, so `KnownMessages` may lack them.
 * The cast therefore brands the object an `UncheckedMessage`.
 */
export function validationMessage(
  key: `validation.${string}`,
  params: Record<string, unknown>,
): UncheckedMessage {
  return { key, params } as UncheckedMessage;
}
