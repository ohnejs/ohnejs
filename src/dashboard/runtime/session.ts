import type { LoginOutcome } from './_session.ts';
import type { DashboardLanguage } from './use-dashboard-language.ts';

import { isNull } from '../../utils/is/is-null.ts';
import { isNullish } from '../../utils/is/is-nullish.ts';
import { isUndefined } from '../../utils/is/is-undefined.ts';
import { deepEqual } from '../../utils/object/deep-equal.ts';
import { ref } from '../../utils/reactive/ref.ts';
import { endSession, startSession } from './_request.ts';
import { loginRefusal } from './_session.ts';
import { api } from './api.ts';
import { dashboardConfig } from './config.ts';
import { loadLanguage } from './messages.ts';
import { invalidateDashboardMeta, resetDashboardMeta } from './meta.ts';
import { requestDashboardLanguage } from './set-dashboard-language.ts';
import { requestedLanguage } from './use-dashboard-language.ts';

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
   * `null` leaves it to `setLanguageFallback`, else the app's default language.
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

let fallback: ((user: SessionUser | null) => DashboardLanguage | undefined) | null = null;
const user = ref<SessionUser | null | undefined>(undefined);
const signIns = ref(0);
let requested = false;

/**
 * Reads the session's user: a user object, `null` signed out, `undefined` while resolving.
 * The first read asks `GET /auth/me` once; every read is reactive, so bindings follow the session.
 *
 * @example
 * ```ts
 * when(() => sessionUser(), () => h('p', null, () => sessionUser()?.email))
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
 * Counts the successful `login` calls since the page loaded; every read is reactive.
 * A load that failed on an expired session reads it to retry once the user signs in again in place.
 *
 * @example
 * ```ts
 * effect(() => {
 *   signInCount()
 *   void loadRows()
 * })
 * ```
 */
export function signInCount(): number {
  return signIns.value;
}

/**
 * Picks the dashboard language for a user who has none, or for no user while signed out.
 * Returning `undefined` keeps the app's default.
 * Call it from a dashboard boot file, so the first page already builds in the picked language.
 *
 * @example
 * ```ts
 * setLanguageFallback(() => (navigator.language.startsWith('en') ? 'en' : undefined))
 * ```
 */
export function setLanguageFallback(
  next: ((user: SessionUser | null) => DashboardLanguage | undefined) | null,
): void {
  fallback = next;
}

/**
 * Signs in with an email and password.
 * Success stores the session cookie and updates `sessionUser` reactively.
 * A same-user sign-in refreshes the discovery store in place; another user empties it first.
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
  if (!response.ok) return loginRefusal(response);
  const answer = (await response.json()) as SessionUser;
  const language = await loadLanguageOf(answer);
  startSession();
  apply(answer, language, true);
  signIns.value += 1;
  return { kind: 'signed-in' };
}

/**
 * Writes a partial of the signed-in user's own record through `PATCH /auth/me` and stores the answer.
 * The patch takes the account fields and `password`; an unknown key is a `422`, like a collection write.
 * A saved answer applies at once: the dashboard language switches, and every preference reads fresh.
 */
export async function updateSessionUser(patch: Record<string, unknown>): Promise<UpdateOutcome> {
  try {
    const response = await api('PATCH /auth/me', {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (response.ok) {
      const answer = (await response.json()) as SessionUser;
      apply(answer, await loadLanguageOf(answer));
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
 * The dashboard language returns to the fallback's pick, else the app's default.
 * The server-side session is revoked too; an unreachable API still signs the browser out locally.
 */
export async function logout(): Promise<void> {
  endSession();
  try {
    await api('POST /auth/logout');
  } catch {}
  apply(null, await loadLanguageOf(null));
}

/**
 * Requests the language `languageOf` picks now, once the boot files set the fallback.
 * A session still resolving takes the signed-out pick, since only signed-out pages show before it lands.
 */
export function settleSessionLanguage(): void {
  const language = languageOf(user.value ?? null);
  if (requestedLanguage().value !== language) requestDashboardLanguage(language);
}

/**
 * Resolves the session once from `GET /auth/me`; a `204` or any failure reads as signed out.
 * The answer fills only the still-unresolved state, so it never overwrites a login that beat it.
 */
async function resolve(): Promise<void> {
  let answer: SessionUser | null = null;
  try {
    const response = await api('GET /auth/me');
    if (response.status === 200) answer = (await response.json()) as SessionUser;
  } catch {}
  const language = await loadLanguageOf(answer);
  if (!isUndefined(user.value)) return;
  if (isNull(answer)) {
    apply(null, language);
    return;
  }
  startSession();
  apply(answer, language, true);
}

/**
 * The dashboard language `user` renders in: their own, else the fallback's pick, else the app's default.
 */
function languageOf(user: SessionUser | null): DashboardLanguage {
  return user?.dashboardLanguage ?? fallback?.(user) ?? dashboardConfig().defaultLanguage;
}

/**
 * Loads the catalogs of the language `user` renders in, and answers it.
 * A boot file that sets the fallback meanwhile changes the pick, so it loads once more.
 */
async function loadLanguageOf(user: SessionUser | null): Promise<DashboardLanguage> {
  const language = languageOf(user);
  await loadLanguage(language);
  const now = languageOf(user);
  if (now !== language) await loadLanguage(now);
  return now;
}

/**
 * Stores a user and applies their dashboard `language`.
 * Its catalogs load first, through `loadLanguageOf`, so the text switches with every message ready.
 * The discovery store empties on a new identity, since it describes what one user may see.
 * Otherwise `refresh` refetches it in place, keeping the current data until the answer lands.
 */
function apply(next: SessionUser | null, language: DashboardLanguage, refresh = false): void {
  const previous = user.value;
  requestDashboardLanguage(language);
  if (!sameIdentity(previous, next)) resetDashboardMeta();
  else if (refresh) invalidateDashboardMeta();
  user.value = next;
}

/**
 * Whether two users are one identity: the same `UUID` holding the same roles, in any order.
 */
function sameIdentity(a: SessionUser | null | undefined, b: SessionUser | null): boolean {
  if (isNullish(a) || isNull(b)) return false;
  return a.UUID === b.UUID && deepEqual(a.roles.toSorted(), b.roles.toSorted());
}
