import type { RoleName } from 'ohnejs';

declare module 'ohnejs' {
  interface EventContext {
    /**
     * The signed-in user, set by the `auth` and `require-auth` middleware.
     * It stays optional, since a request without either middleware never sets it.
     * Behind `require-auth` it is always present.
     */
    user?: User;
  }
}

/**
 * The public shape of a user, as `useUser` and the auth routes return it.
 * The `password` hash never appears here, so it cannot leak through a helper's return value.
 */
export interface User {
  /**
   * The user's stable identifier.
   */
  UUID: string;

  /**
   * The user's email, stored trimmed and lowercased.
   */
  email: string;

  /**
   * The role names the user holds.
   * The capabilities of every held role union; resolve them with `userCapabilities`.
   */
  roles: RoleName[];

  /**
   * The language the dashboard renders in, as a canonical BCP-47 tag like `de-AT`.
   * `null` leaves the dashboard on the app's default language.
   */
  dashboardLanguage: string | null;

  /**
   * The content locale the dashboard opens records in, one of the configured `collections.locales`.
   * `null` leaves it on the default locale.
   */
  contentLanguage: string | null;

  /**
   * The IANA time zone the dashboard displays and edits instants in, like `Europe/Berlin`.
   * `null` leaves it on the device's own time zone.
   */
  timezone: string | null;

  /**
   * The pattern the dashboard formats dates with, like `YYYY-MM-DD`.
   */
  dateFormat: string;

  /**
   * The pattern the dashboard formats times with, like `HH:mm:ss`.
   */
  timeFormat: string;

  /**
   * Whether the dashboard watches the clipboard in the background, so a copied record pastes at once.
   */
  smartClipboard: boolean;
}

/**
 * One session row, as `useSession` returns it.
 * The token itself lives only in the cookie.
 * The row stores its hash under a `readable: false` field, so no read returns it.
 */
export interface Session {
  /**
   * The session's stable identifier.
   */
  UUID: string;

  /**
   * The `UUID` of the user the session belongs to.
   */
  user: string | null;

  /**
   * When the session expires, in epoch milliseconds.
   */
  expiresAt: number;
}
