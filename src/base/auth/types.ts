import type { RoleName } from 'ohnejs';

import type { User as ContractUser } from '../ohne.contract.ts';

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
 * The auth routes also answer every readable field the account layout places beyond these members.
 */
export interface User extends ContractUser {
  /**
   * The role names the user holds.
   * The capabilities of every held role union; resolve them with `userCapabilities`.
   */
  roles: RoleName[];
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
