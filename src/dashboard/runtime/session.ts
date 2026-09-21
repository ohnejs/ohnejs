import type { LoginOutcome } from './_session.ts';
import type { DashboardLanguage } from './use-dashboard-language.ts';

import { isNull } from '../../utils/is/is-null.ts';
import { isUndefined } from '../../utils/is/is-undefined.ts';
import { ref } from '../../utils/reactive/ref.ts';
import { endSession, startSession } from './_request.ts';
import { loginRefusal } from './_session.ts';
import { api } from './api.ts';
import { dashboardConfig } from './config.ts';
import { invalidateDashboardMeta } from './meta.ts';
import { useDashboardLanguage } from './use-dashboard-language.ts';

export type { LoginOutcome };

/**
 * The signed-in user, as `GET /auth/me`, a successful login, and a saved `updateSessionUser` answer it.
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

  /**
   * The language the dashboard renders in, as a canonical BCP-47 tag like `de-AT`.
   * `null` leaves the dashboard on the app's default language.
   */
  dashboardLanguage: DashboardLanguage | null;

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
 * How an `updateSessionUser` write ended.
 */
export type UpdateOutcome =
  | {
      /**
       * The server stored the patch, and the store already holds the answered user.
       */
      kind: 'saved';

      /**
       * The user as the server answers it, every field current.
       */
      user: SessionUser;
    }
  | {
      /**
       * The server refused the patch with a `422`; nothing was stored.
       */
      kind: 'invalid';

      /**
       * The server's messages by field path, in the dashboard language, ready for a form to route.
       */
      errors: Readonly<Record<string, string>>;
    }
  | {
      /**
       * The request never completed: a network failure.
       */
      kind: 'unreachable';
    }
  | {
      /**
       * The server answered a status the write has no reading for, like a `401` or a `500`.
       */
      kind: 'failed';

      /**
       * The answered HTTP status.
       */
      status: number;
    };

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
 * The user's dashboard language applies at once, so every message renders in it.
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
    return { kind: 'unreachable' };
  }
  if (!response.ok) return loginRefusal(response.status);
  startSession();
  apply((await response.json()) as SessionUser);
  invalidateDashboardMeta();
  return { kind: 'signed-in' };
}

/**
 * Writes a partial of the signed-in user's own record through `PATCH /auth/me` and stores the answer.
 * The patch takes the account fields and `password`; an unknown key is a `422`, like a collection write.
 * A saved answer applies at once: the dashboard language switches, and every preference reads fresh.
 * The discovery store resets only when the language changed, since its labels are baked in one language.
 */
export async function updateSessionUser(patch: Record<string, unknown>): Promise<UpdateOutcome> {
  try {
    const response = await api('PATCH /auth/me', {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (response.ok) {
      const answer = (await response.json()) as SessionUser;
      if (apply(answer)) invalidateDashboardMeta();
      return { kind: 'saved', user: answer };
    }
    if (response.status === 422) {
      const answer = (await response.json()) as { data?: { errors?: Record<string, string> } };
      const errors = Object.create(null) as Record<string, string>;
      Object.assign(errors, answer.data?.errors ?? {});
      return { kind: 'invalid', errors };
    }
    return { kind: 'failed', status: response.status };
  } catch {
    return { kind: 'unreachable' };
  }
}

/**
 * Signs out: `sessionUser` becomes `null` and the discovery store resets.
 * The dashboard language returns to the app's default.
 * The server-side session is revoked too; an unreachable API still signs the browser out locally.
 */
export async function logout(): Promise<void> {
  endSession();
  try {
    await api('POST /auth/logout');
  } catch {}
  apply(null);
  invalidateDashboardMeta();
}

/**
 * Resolves the session once from `GET /auth/me`; any failure reads as signed out.
 * The answer fills only the still-unresolved state, so it never overwrites a login that beat it.
 * The discovery store resets only when the user's language differs from the default it started on.
 */
async function resolve(): Promise<void> {
  let answer: SessionUser | null = null;
  try {
    const response = await api('GET /auth/me');
    if (response.ok) answer = (await response.json()) as SessionUser;
  } catch {}
  if (!isUndefined(user.value)) return;
  if (!isNull(answer)) startSession();
  if (apply(answer)) invalidateDashboardMeta();
}

/**
 * Stores a user and applies their dashboard language, the app's default for a signed-out or unset one.
 * Answers whether the language changed, since the discovery store's labels are baked in one language.
 */
function apply(next: SessionUser | null): boolean {
  const language = useDashboardLanguage();
  const tag = next?.dashboardLanguage ?? dashboardConfig().defaultLanguage;
  const changed = language.value !== tag;
  language.value = tag;
  user.value = next;
  return changed;
}
