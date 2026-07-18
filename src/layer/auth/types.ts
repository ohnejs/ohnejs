declare module 'ohne' {
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
}

/**
 * One session row, as `useSession` returns it.
 * The token itself lives only in the cookie; the row carries its hash and expiry.
 */
export interface Session {
  /**
   * The session's stable identifier.
   */
  UUID: string;

  /**
   * The `UUID` of the user the session belongs to, or `null` if the user was removed.
   */
  user: string | null;

  /**
   * The sha256 of the session's cookie token, base64url-encoded.
   */
  tokenHash: string;

  /**
   * When the session expires, in epoch milliseconds.
   */
  expiresAt: number;
}
