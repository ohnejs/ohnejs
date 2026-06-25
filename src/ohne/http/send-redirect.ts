import { useEvent } from './use-event.ts';

/**
 * Redirects the client: sets the status and the `Location` header together.
 * Writes `useEvent().response`; valid only within a request.
 *
 * The handler returns nothing after calling this; the empty body is serialized at the redirect status.
 * A `location` carrying a CR or LF is rejected by `Headers.set`, so it cannot smuggle a second header.
 *
 * @example
 * ```ts
 * export default defineHandler(() => {
 *   if (!useCookies().sid) sendRedirect('/login')
 *   return dashboard()
 * })
 *
 * export default defineHandler(() => sendRedirect('/elsewhere', 301))
 * ```
 */
export function sendRedirect(location: string, status = 302): void {
  const { response } = useEvent();
  response.status = status;
  response.headers.set('location', location);
}
