import { useConfig } from 'ohnejs';
import { withDefaults } from 'ohnejs/utils';

declare module 'ohnejs' {
  interface Config {
    /**
     * Authentication settings for the `ohnejs/base` layer's `Users` sessions.
     */
    auth?: {
      /**
       * How long a remembered session stays valid, as a `parseDuration` value.
       * It is also the ceiling: no session outlives it, however it was opened.
       *
       * @default
       * '30d'
       *
       * @example
       * ```ts
       * auth: { sessionMaxAge: '7d' }
       * ```
       */
      sessionMaxAge?: number | string;

      /**
       * How long a session opened without remember me stays valid, as a `parseDuration` value.
       * Its cookie also ends with the browser session, so closing the browser drops it earlier.
       * A value above `sessionMaxAge` is capped to it.
       *
       * @default
       * '1d'
       *
       * @example
       * ```ts
       * auth: { transientSessionMaxAge: '2h' }
       * ```
       */
      transientSessionMaxAge?: number | string;

      /**
       * Name of the cookie the session token travels in.
       *
       * @default
       * 'session'
       */
      cookieName?: string;

      /**
       * How hard passwords are to hash, using the scrypt algorithm.
       * Costlier settings resist cracking better but make every sign-in slower.
       * The defaults suit most servers.
       */
      password?: {
        /**
         * The main dial for how hard a stored password is to crack.
         * Higher is safer but slower, and each doubling doubles the work; it must be a power of two.
         * The one setting worth tuning: raise it until a sign-in takes about 100ms on your server, then stop.
         *
         * @default
         * 32768
         */
        cost?: number;

        /**
         * How much memory each hash uses.
         * More memory is what makes cracking with cheap parallel hardware expensive.
         * Leave it at the default unless you have measured a reason to change it.
         *
         * @default
         * 8
         */
        blockSize?: number;

        /**
         * How many independent passes each hash runs.
         * Leave it at the default; raise it only to spend more CPU cores on a single hash.
         *
         * @default
         * 1
         */
        parallelization?: number;
      };
    };
  }
}

/**
 * The resolved auth settings: every `Config.auth` field, with the layer defaults filled in.
 */
export interface ResolvedAuthConfig {
  /**
   * How long a remembered session stays valid, and the ceiling for every session.
   */
  sessionMaxAge: number | string;

  /**
   * How long a session opened without remember me stays valid.
   */
  transientSessionMaxAge: number | string;

  /**
   * Name of the cookie the session token travels in.
   */
  cookieName: string;

  /**
   * The scrypt cost passed to `hashPassword`.
   */
  password: {
    /**
     * The scrypt CPU/memory cost.
     */
    cost: number;

    /**
     * The scrypt block size.
     */
    blockSize: number;

    /**
     * The scrypt parallelization factor.
     */
    parallelization: number;
  };
}

/**
 * The auth defaults the `ohnejs/base` layer contributes through `ohne.layer.ts`.
 * The single source `useAuthConfig` also falls back to, so the framework's own repo resolves them too.
 */
export const AUTH_DEFAULTS = {
  sessionMaxAge: '30d',
  transientSessionMaxAge: '1d',
  cookieName: 'session',
  password: {
    cost: 32_768,
    blockSize: 8,
    parallelization: 1,
  },
} satisfies ResolvedAuthConfig;

/**
 * Returns the resolved auth settings, `Config.auth` merged over the layer defaults.
 * Valid wherever config is, so the auth routes and helpers read one consistent shape.
 */
export function useAuthConfig(): ResolvedAuthConfig {
  return withDefaults(useConfig().auth ?? {}, AUTH_DEFAULTS);
}
