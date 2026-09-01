import { isUndefined } from '../../utils/is/is-undefined.ts';
import { ref } from '../../utils/reactive/ref.ts';
import { api } from './api.ts';
import { invalidateDashboardMeta } from './meta.ts';

/**
 * The signed-in user, as `GET /auth/me` and a successful login answer it.
 */
export interface SessionUser {
  /**
   * The user's `UUID` in the `Users` collection.
   */
  UUID: string;

  /**
   * The user's email address, normalized.
   */
  email: string;

  /**
   * The role names the user holds.
   */
  roles: string[];
}

/**
 * How a `login` attempt ended.
 * `signed-in` stored the session; `invalid` is a wrong email or password; `unreachable` a network failure.
 */
export type LoginOutcome = 'signed-in' | 'invalid' | 'unreachable';

const user = ref<SessionUser | null | undefined>(undefined);
let requested = false;

/**
 * Reads the session's user: a user object, `null` signed out, `undefined` while resolving.
 * The first read asks `GET /auth/me` once; every read is reactive, so bindings follow the session.
 *
 * @example
 * ```ts
 * when(() => sessionUser(), () => shell())
 * ```
 */
export function sessionUser(): SessionUser | null | undefined {
  if (!requested) {
    requested = true;
    void resolve();
  }
  return user.value;
}

/**
 * Signs in with an email and password.
 * Success stores the session cookie, updates `sessionUser` reactively, and resets the discovery store.
 * `remember` picks the session's lifetime: with it the long one, without it the short one.
 * A session opened without it also gets a cookie that ends with the browser.
 * The API never says whether the email or the password was wrong.
 */
export async function login(
  email: string,
  password: string,
  remember = false,
): Promise<LoginOutcome> {
  let response: Response;
  try {
    response = await api('POST /auth/login', {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, remember }),
    });
  } catch {
    return 'unreachable';
  }
  if (!response.ok) return 'invalid';
  user.value = (await response.json()) as SessionUser;
  invalidateDashboardMeta();
  return 'signed-in';
}

/**
 * Signs out: `sessionUser` becomes `null` and the discovery store resets.
 * The server-side session is revoked too; an unreachable API still signs the browser out locally.
 */
export async function logout(): Promise<void> {
  try {
    await api('POST /auth/logout');
  } catch {
    /* the cookie may outlive an unreachable API; the SPA session still ends */
  }
  user.value = null;
  invalidateDashboardMeta();
}

/**
 * Resolves the session once from `GET /auth/me`; any failure reads as signed out.
 * The answer fills only the still-unresolved state, so it never overwrites a login that beat it.
 */
async function resolve(): Promise<void> {
  let answer: SessionUser | null = null;
  try {
    const response = await api('GET /auth/me');
    if (response.ok) answer = (await response.json()) as SessionUser;
  } catch {
    /* unreachable reads as signed out */
  }
  if (isUndefined(user.value)) user.value = answer;
}
