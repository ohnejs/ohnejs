/**
 * Shortens a `UUID` to its last eight hex characters, a handle that tells records apart at a glance.
 * The tail is random in v4 and v7, while a UUIDv7's head is a timestamp that repeats for about a minute.
 *
 * @example
 * ```ts
 * shortUUID('019f3c1a-8b2d-7f4e-9a6b-1c2d3e4f5a6b') // -> '3e4f5a6b'
 * ```
 */
export function shortUUID(uuid: string): string {
  return uuid.slice(-8);
}
