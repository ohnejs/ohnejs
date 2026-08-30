import type { Message } from '../messages/known-messages.ts';

/**
 * A parameterized `validation.*` failure as its `{ key, params }` message object.
 * The keys live in the framework layer's catalog, resolved at the boundary, never in `KnownMessages`.
 * Their objects are therefore not `Message` members here; the cast bridges them.
 */
export function validationMessage(
  key: `validation.${string}`,
  params: Record<string, unknown>,
): Message {
  return { key, params } as unknown as Message;
}
