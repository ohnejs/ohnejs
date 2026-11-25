import type { RoleName } from 'ohnejs';

import type { User as ContractUser } from '../ohne.contract.ts';

export type { Passkey } from '../ohne.contract.ts';

declare module 'ohnejs' {
  interface EventContext {
    /**
     * The signed-in user, set by the `auth` and `require-auth` middleware.
     * It stays optional, since a request without either middleware never sets it.
     * Behind `require-auth` it is always present.
     */
    user?: User;
  }

  interface Hooks {
    /**
     * Fires when `createSession` opens a session, inside the request, so `useEvent().ip` names the client.
     * A throw refuses the sign-in: the session is removed and no cookie is sent.
     */
    'auth:signed-in': (signIn: SignIn) => void | Promise<void>;

    /**
     * Fires when a password or a passkey is refused, at sign-in or when a user confirms who they are.
     * It runs inside the request, so `useEvent().ip` names the client.
     */
    'auth:credential-rejected': (rejection: CredentialRejection) => void | Promise<void>;
  }
}

/**
 * A sign-in, as the `auth:signed-in` hook receives it.
 */
export interface SignIn {
  /**
   * The `UUID` of the user who signed in.
   */
  user: string;

  /**
   * The `UUID` of the new session.
   */
  session: string;

  /**
   * What the user signed in with, or the name your own sign-in passes to `createSession`.
   */
  method: 'password' | 'passkey' | 'install' | (string & {});

  /**
   * Whether the sign-in proved two factors at once.
   * A passkey does: the device holds the key, and Face ID, a fingerprint or a PIN verified the user.
   */
  multiFactor: boolean;
}

/**
 * A refused credential, as the `auth:credential-rejected` hook receives it.
 */
export interface CredentialRejection {
  /**
   * What was refused.
   */
  method: 'password' | 'passkey';

  /**
   * The email a password sign-in named, whether or not an account has it.
   */
  email?: string;

  /**
   * The `UUID` of the user the credential was tried for, when one is known.
   */
  user?: string;
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

  /**
   * When the user last proved who they are on this session, in epoch milliseconds.
   * Signing in sets it, and so does `POST /auth/reauth`.
   */
  verifiedAt: number | null;
}
