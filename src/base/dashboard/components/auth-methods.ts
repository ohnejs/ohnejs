import { api } from 'ohnejs/dashboard';
import { ref } from 'ohnejs/utils';

/**
 * The ways of signing in the app offers, as `GET /auth/methods` answers them.
 */
export interface AuthMethods {
  /**
   * Whether users may sign in with a password.
   */
  password: boolean;

  /**
   * Whether users may sign in with a passkey.
   */
  passkeys: boolean;
}

const methods = ref<AuthMethods | undefined>(undefined);
let requested = false;

/**
 * Reads the app's sign-in methods, `undefined` until `GET /auth/methods` answers.
 * The first read asks once per page; every read is reactive.
 * A failed request reads as password only.
 */
export function authMethods(): AuthMethods | undefined {
  if (!requested) {
    requested = true;
    void api('/auth/methods')
      .then((response) => (response.ok ? (response.json() as Promise<AuthMethods>) : undefined))
      .catch(() => undefined)
      .then((answer) => {
        methods.value = answer ?? { password: true, passkeys: false };
      });
  }
  return methods.value;
}
