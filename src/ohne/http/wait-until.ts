import { useEvent } from './use-event.ts';

/**
 * Keeps background work alive past the response.
 * Calls `useEvent().waitUntil`; valid only within a request.
 *
 * The response is sent without waiting for it, and a graceful shutdown waits for the work to settle.
 * A rejection is isolated and logged, never touching the sent response.
 * Best for short side effects like logging or analytics; durable work belongs in a queue, not here.
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
