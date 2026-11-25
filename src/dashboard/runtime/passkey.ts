import { isNull } from '../../utils/is/is-null.ts';
import { api } from './api.ts';

/**
 * Whether this browser can use passkeys: a secure context with the WebAuthn JSON methods.
 * Plain `http:` on anything but `localhost` is not secure, so passkeys are off there.
 *
 * @example
 * ```ts
 * when(passkeysSupported, () => button('Add passkey', { onClick: add }))
 * ```
 */
export function passkeysSupported(): boolean {
  return (
    globalThis.isSecureContext &&
    typeof globalThis.PublicKeyCredential?.parseRequestOptionsFromJSON === 'function'
  );
}

/**
 * Asks the browser for a passkey that answers `options`, as the server issued them in JSON.
 * Resolves the credential as JSON, ready to post back, or `null` when the user dismisses the prompt.
 *
 * @example
 * ```ts
 * const options = await (await api('POST /auth/passkey/options')).json()
 * const credential = await getPasskey(options)
 * ```
 */
export async function getPasskey(
  options: PublicKeyCredentialRequestOptionsJSON,
): Promise<AuthenticationResponseJSON | null> {
  const publicKey = PublicKeyCredential.parseRequestOptionsFromJSON(options);
  const credential = await answer(() => navigator.credentials.get({ publicKey }));
  return (credential?.toJSON() as AuthenticationResponseJSON | undefined) ?? null;
}

/**
 * Asks the browser to create a passkey for `options`, as the server issued them in JSON.
 * Resolves the new credential as JSON, ready to post back, or `null` when the user dismisses the prompt.
 *
 * @example
 * ```ts
 * const options = await (await api('POST /auth/passkey/register/options')).json()
 * const credential = await createPasskey(options)
 * ```
 */
export async function createPasskey(
  options: PublicKeyCredentialCreationOptionsJSON,
): Promise<RegistrationResponseJSON | null> {
  const publicKey = PublicKeyCredential.parseCreationOptionsFromJSON(options);
  const credential = await answer(() => navigator.credentials.create({ publicKey }));
  return (credential?.toJSON() as RegistrationResponseJSON | undefined) ?? null;
}

/**
 * Runs a WebAuthn prompt; a dismissed or timed out one resolves `undefined`.
 */
async function answer(
  prompt: () => Promise<Credential | null>,
): Promise<PublicKeyCredential | undefined> {
  try {
    const credential = await prompt();
    return credential instanceof PublicKeyCredential ? credential : undefined;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotAllowedError') return undefined;
    throw error;
  }
}

/**
 * Creates a passkey for the signed-in user and stores it, through the `ohnejs/base` routes.
 * Resolves the server's answer, or `null` when the user dismisses the prompt.
 * Send it through `withReauth`, since adding a passkey may ask the user to confirm who they are.
 *
 * @example
 * ```ts
 * const response = await withReauth(registerPasskey)
 * ```
 */
export async function registerPasskey(): Promise<Response | null> {
  const options = await api('POST /auth/passkey/register/options');
  if (!options.ok) return options;
  const credential = await createPasskey(
    (await options.json()) as PublicKeyCredentialCreationOptionsJSON,
  );
  if (isNull(credential)) return null;
  return api('POST /auth/passkey/register', {
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ credential }),
  });
}
