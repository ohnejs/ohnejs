/**
 * The signed-in user, as `GET /auth/me` and a sign-in answer it.
 * The auth routes also answer every readable field the account layout places beyond these members.
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
   * The user's first name; `null` when not given.
   */
  firstName: string | null;

  /**
   * The user's last name; `null` when not given.
   */
  lastName: string | null;

  /**
   * The role names the user holds.
   */
  roles: string[];

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
 * What `POST /auth/login` reads.
 */
export interface LoginBody {
  /**
   * The account's email.
   */
  email: string;

  /**
   * The account's password.
   */
  password: string;

  /**
   * Picks the long session lifetime.
   *
   * @default
   * false
   */
  remember?: boolean;
}

/**
 * What `PATCH /auth/me` reads under the default account layout.
 * An `auth:account-layout` hook that places other fields needs its own entry in your `ohne.contract.ts`.
 */
export interface AccountBody extends Partial<
  Pick<
    User,
    | 'firstName'
    | 'lastName'
    | 'contentLanguage'
    | 'dashboardLanguage'
    | 'timezone'
    | 'dateFormat'
    | 'timeFormat'
    | 'smartClipboard'
  >
> {
  /**
   * The new password.
   */
  password?: string;
}

/**
 * What `POST /auth/install` reads to create the first user.
 */
export interface InstallBody {
  /**
   * The first user's email.
   */
  email: string;

  /**
   * The first user's password.
   */
  password: string;

  /**
   * The first user's first name, kept when `Users` declares it.
   */
  firstName?: string;

  /**
   * The first user's last name, kept when `Users` declares it.
   */
  lastName?: string;
}

/**
 * The contracts of the `auth` routes.
 */
export interface Routes {
  'POST /auth/login': { body: LoginBody; response: User };
  'POST /auth/logout': { response: { ok: true } };
  'POST /auth/logout/others': { response: { ok: true } };
  'GET /auth/me': { response: User | null };
  'PATCH /auth/me': { body: AccountBody; response: User };
  'GET /auth/install': { response: { required: boolean } };
  'POST /auth/install': { body: InstallBody; response: User };
}
