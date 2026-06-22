import { useEvent } from './use-event.ts';

/**
 * Keeps background work alive past the response.
 * Calls `useEvent().waitUntil`; valid only within a request.
 *
 * The response is sent immediately.
 * The promise runs after and holds the request's drain ticket until it settles, so shutdown waits for it.
 * A rejection is isolated and logged, never touching the sent response.
 *
 * @example
 * ```ts
 * export default defineHandler(async () => {
 *   const user = await createUser()
 *
 *   // Send a welcome email after the response is sent
 *   waitUntil(sendWelcomeEmail(user))
 *
 *   return user
 * })
 * ```
 */
export function waitUntil(promise: Promise<unknown>): void {
  useEvent().waitUntil(promise);
}
