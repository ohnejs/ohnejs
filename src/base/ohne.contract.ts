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
  /**
   * The password `password` replaces, required alongside it.
   */
  currentPassword?: string;
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
   * The first user's password, required unless `auth.password` is `false`.
   */
  password?: string;

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
 * One of the signed-in user's passkeys, as the `/auth/passkey` routes answer it.
 */
export interface Passkey {
  /**
   * The passkey's stable identifier.
   */
  UUID: string;

  /**
   * The label the user gave it.
   */
  name: string;

  /**
   * Whether it syncs across the user's devices, like an iCloud Keychain or Google Password Manager passkey.
   */
  synced: boolean;

  /**
   * When it was added, in epoch milliseconds.
   */
  createdAt: number;

  /**
   * When it last signed in or confirmed, in epoch milliseconds.
   */
  lastUsedAt: number | null;
}

/**
 * A credential a passkey prompt may offer.
 */
export interface PasskeyDescriptor {
  /**
   * Always `'public-key'`.
   */
  type: 'public-key';

  /**
   * The credential id, base64url.
   */
  id: string;

  /**
   * How the browser may reach the authenticator, such as `'internal'` or `'usb'`.
   */
  transports: string[];
}

/**
 * The options `navigator.credentials.get` takes, in the JSON `parseRequestOptionsFromJSON` reads.
 */
export interface PasskeyRequestOptions {
  /**
   * The challenge to sign, base64url.
   */
  challenge: string;

  /**
   * The RP ID the passkey must belong to.
   */
  rpId: string;

  /**
   * How long the prompt may stay open, in milliseconds.
   */
  timeout: number;

  /**
   * Always `'required'`: the passkey must verify the user by Face ID, fingerprint or PIN.
   */
  userVerification: 'required';

  /**
   * The signed-in user's own passkeys, or none to let any passkey of the site answer.
   */
  allowCredentials: PasskeyDescriptor[];
}

/**
 * The options `navigator.credentials.create` takes, in the JSON `parseCreationOptionsFromJSON` reads.
 */
export interface PasskeyCreationOptions {
  /**
   * The challenge to sign, base64url.
   */
  challenge: string;

  /**
   * The site the passkey belongs to.
   */
  rp: { id: string; name: string };

  /**
   * The account the passkey signs in to, its `id` the user's `UUID` in base64url.
   */
  user: { id: string; name: string; displayName: string };

  /**
   * The signature algorithms accepted, as COSE identifiers.
   */
  pubKeyCredParams: { type: 'public-key'; alg: number }[];

  /**
   * How long the prompt may stay open, in milliseconds.
   */
  timeout: number;

  /**
   * Always `'none'`: the authenticator's make is not asked for.
   */
  attestation: 'none';

  /**
   * A discoverable passkey that verifies the user.
   */
  authenticatorSelection: {
    residentKey: 'required';
    requireResidentKey: true;
    userVerification: 'required';
  };

  /**
   * The user's passkeys already registered, so the same authenticator is not added twice.
   */
  excludeCredentials: PasskeyDescriptor[];
}

/**
 * A passkey's answer to a challenge, as `PublicKeyCredential.toJSON()` gives it.
 */
export interface PasskeyCredential {
  /**
   * The credential id, base64url.
   */
  id: string;

  /**
   * Always `'public-key'`.
   */
  type: string;

  /**
   * The authenticator's response, its fields base64url.
   */
  response: Record<string, unknown>;
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
  'GET /auth/methods': { response: { password: boolean; passkeys: boolean } };
  'POST /auth/reauth': {
    body: { password: string } | { credential: PasskeyCredential };
    response: { ok: true };
  };
  'POST /auth/passkey/options': { response: PasskeyRequestOptions };
  'POST /auth/passkey/login': {
    body: { credential: PasskeyCredential; remember?: boolean };
    response: User;
  };
  'POST /auth/passkey/register/options': { response: PasskeyCreationOptions };
  'POST /auth/passkey/register': {
    body: { credential: PasskeyCredential; name?: string };
    response: Passkey;
  };
  'GET /auth/passkey': { response: Passkey[] };
  'PATCH /auth/passkey/[uuid]': { body: { name: string }; response: Passkey };
  'DELETE /auth/passkey/[uuid]': { response: null };
}
