import { hmac } from './hmac.ts';

const HEADER = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');

/**
 * Signs `payload` as an HS256 JSON Web Token under `secret`.
 * The payload is encoded as given, so set claims such as `exp` yourself.
 *
 * @example
 * ```ts
 * signJWT({ sub: 'thrall' }, 'secret')
 * // -> 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0aHJhbGwifQ.Fl8yWUMyelsVOHoV8MKhO9MZP_pEFtfXeF6Cwl0NcqQ'
 * ```
 */
export function signJWT(payload: Record<string, unknown>, secret: string | Uint8Array): string {
  const body = `${HEADER}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
  return `${body}.${hmac(body, secret)}`;
}
