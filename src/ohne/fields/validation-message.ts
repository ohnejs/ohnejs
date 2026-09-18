import type { Message } from '../messages/known-messages.ts';

/**
 * A parameterized `validation.*` failure as its `{ key, params }` message object.
 * The keys live in the `ohnejs/base` catalog, which an app can disable, so `KnownMessages` may lack them.
 * Their objects are therefore not `Message` members here; the cast bridges them.
 */
export function validationMessage(
  key: `validation.${string}`,
  params: Record<string, unknown>,
): Message {
  return { key, params } as unknown as Message;
}
