import {
  applyHook,
  badRequest,
  deleteCookie,
  notFound,
  queryUntyped,
  setSignedCookie,
  unauthorized,
  useConfig,
  useRateLimitStore,
  useSignedCookies,
} from 'ohnejs';
import {
  type AuthenticationResponseJSON,
  createRateLimiter,
  isAuthenticationResponseJSON,
  isNull,
  isRegistrationResponseJSON,
  isString,
  isUndefined,
  parseDuration,
  type PublicKeyJWK,
  type RateLimiter,
  type RegistrationResponseJSON,
  verifyWebAuthnAuthentication,
  type WebAuthnExpectation,
} from 'ohnejs/utils';
import { randomToken } from 'ohnejs/utils/crypto';

import type { Passkey } from './types.ts';

import { translate } from '../../ohne/http/translate.ts';
import { dashboardOrigin } from '../http/dashboard-origin.ts';
import { useAuthConfig } from './config.ts';

/**
 * Where passkeys belong: the RP ID they are scoped to, and the origins a ceremony may run on.
 */
export interface RelyingParty {
  rpID: string;
  origin: string[];
}

/**
 * The ceremony a challenge was issued for: `get` signs in or confirms, `create` registers.
 */
type Ceremony = 'get' | 'create';

const CHALLENGE_COOKIE = 'ohne-passkey';

/**
 * How long a challenge stays usable, and the `timeout` the browser is told.
 */
export const CHALLENGE_LIFETIME = parseDuration('5m');

const replayGuards = new WeakMap<object, RateLimiter>();

/**
 * The relying party `auth.passkeys` describes; a `404` while passkeys are off.
 * The origin defaults to the dashboard's, and the RP ID to that origin's host name.
 */
export function requirePasskeys(): RelyingParty {
  const { passkeys } = useAuthConfig();
  if (passkeys === false) throw notFound();
  const options = passkeys === true ? {} : passkeys;
  const origin = isUndefined(options.origin)
    ? [dashboardOrigin()]
    : isString(options.origin)
      ? [options.origin]
      : options.origin;
  return { rpID: options.rpID ?? new URL(origin[0] as string).hostname, origin };
}

/**
 * Issues a challenge for `ceremony` in a signed cookie that lives `CHALLENGE_LIFETIME`.
 * With `user`, only that user's session may take it.
 */
export function issueChallenge(ceremony: Ceremony, user = ''): string {
  const challenge = randomToken(32);
  const expiresAt = Date.now() + CHALLENGE_LIFETIME;
  setSignedCookie(CHALLENGE_COOKIE, [ceremony, challenge, expiresAt, user].join(':'), {
    path: '/',
    maxAge: CHALLENGE_LIFETIME / 1000,
  });
  return challenge;
}

/**
 * Takes the request's challenge for `ceremony` and `user`, once: the cookie clears and a replay reads `null`.
 * A missing, tampered, expired or foreign challenge reads `null` too.
 */
export async function takeChallenge(ceremony: Ceremony, user = ''): Promise<string | null> {
  const value = useSignedCookies()[CHALLENGE_COOKIE];
  if (isUndefined(value)) return null;
  deleteCookie(CHALLENGE_COOKIE, { path: '/' });
  const [issuedFor, challenge = '', expiresAt, boundTo] = value.split(':');
  if (issuedFor !== ceremony || boundTo !== user || Number(expiresAt) <= Date.now()) return null;
  return (await replayGuard().hit(challenge)) === 0 ? challenge : null;
}

/**
 * Counts each challenge once in the app's rate-limit store, so a replayed cookie finds it spent.
 */
function replayGuard(): RateLimiter {
  const config = useConfig();
  let guard = replayGuards.get(config);
  if (isUndefined(guard)) {
    guard = createRateLimiter({
      name: 'ohne:passkey-challenge',
      limit: 1,
      window: CHALLENGE_LIFETIME,
      store: useRateLimitStore(),
    });
    replayGuards.set(config, guard);
  }
  return guard;
}

/**
 * What a ceremony must match: the challenge, the relying party, and a verified user.
 */
export function expectation(challenge: string, party: RelyingParty): WebAuthnExpectation {
  return { challenge, ...party, requireUserVerification: true };
}

/**
 * The `credential` a request body carries, as a sign-in; any other shape is a `400`.
 */
export function readAssertion(credential: unknown): AuthenticationResponseJSON {
  if (!isAuthenticationResponseJSON(credential)) throw badRequest();
  return credential;
}

/**
 * The `credential` a request body carries, as a registration; any other shape is a `400`.
 */
export function readAttestation(credential: unknown): RegistrationResponseJSON {
  if (!isRegistrationResponseJSON(credential)) throw badRequest();
  return credential;
}

/**
 * Verifies a sign-in `assertion` against the stored passkey it names, and records its use.
 * With `user`, only that user's passkeys count.
 * Any failure fires `auth:credential-rejected` and answers `401`.
 * It resolves to the `UUID` of the passkey's user.
 */
export async function verifyAssertion(
  assertion: AuthenticationResponseJSON,
  challenge: string | null,
  user?: string,
): Promise<string> {
  const row = (await queryUntyped('Passkeys')
    .select('UUID', 'user', 'credentialID', 'publicKey', 'signCount')
    .where(
      isUndefined(user) ? { credentialID: assertion.id } : { credentialID: assertion.id, user },
    )
    .findFirst()) as PasskeyRow | undefined;
  const verified =
    isNull(challenge) || isUndefined(row)
      ? undefined
      : await verifyWebAuthnAuthentication(
          assertion,
          { id: row.credentialID, publicKey: row.publicKey, signCount: row.signCount },
          expectation(challenge, requirePasskeys()),
        ).catch(() => undefined);
  if (isUndefined(row) || isUndefined(verified)) {
    await applyHook('auth:credential-rejected', { method: 'passkey', user: user ?? row?.user });
    throw unauthorized(translate('auth.invalidPasskey'));
  }
  await queryUntyped('Passkeys').where({ UUID: row.UUID }).update({
    signCount: verified.signCount,
    backedUp: verified.backedUp,
    lastUsedAt: Date.now(),
  });
  return row.user;
}

/**
 * Projects a `Passkeys` record onto the `Passkey` its owner sees.
 */
export function toPasskey(record: Record<string, unknown>): Passkey {
  return {
    UUID: record.UUID as string,
    name: record.name as string,
    synced: record.backedUp === true,
    createdAt: record.createdAt as number,
    lastUsedAt: (record.lastUsedAt ?? null) as number | null,
  };
}

interface PasskeyRow {
  UUID: string;
  user: string;
  credentialID: string;
  publicKey: PublicKeyJWK;
  signCount: number;
}
