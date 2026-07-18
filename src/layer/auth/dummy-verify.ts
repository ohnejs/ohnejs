import { hashPassword, verifyPassword } from 'ohne/utils/crypto';

import { useAuthConfig } from './config.ts';

let dummy: Promise<string> | undefined;

/**
 * Verifies `password` against a throwaway hash and discards the result, to spend a real check's time.
 * Call it on a login's "no such user" path so timing cannot reveal whether an email is registered.
 * The hash uses the configured cost and is computed once, then reused.
 *
 * @example
 * ```ts
 * if (!user) {
 *   await dummyVerify(password) // spend a real verify's time, then reject
 *   throw unauthorized()
 * }
 * ```
 */
export async function dummyVerify(password: string): Promise<void> {
  dummy ??= hashPassword('ohne-timing-equalizer', useAuthConfig().password);
  await verifyPassword(password, await dummy);
}
