import { useEvent } from './use-event.ts';

/**
 * Sets the status code the response is sent with.
 * Writes `useEvent().response.status`; valid only within a request.
 *
 * The handler still returns its value as the body; this only sets the status the serializer uses.
 *
 * @example
 * ```ts
 * export default defineHandler(async () => {
 *   const user = await createUser()
 *   setResponseStatus(201)
 *   return user
 * })
 * ```
 */
export function setResponseStatus(status: number): void {
  useEvent().response.status = status;
}
