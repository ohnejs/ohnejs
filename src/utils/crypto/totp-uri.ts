import type { TOTPOptions } from './totp-code.ts';

import { encodeRFC3986 } from '../uri/encode-rfc3986.ts';

/**
 * The account an authenticator app enrolls, plus the code parameters it must use.
 */
export interface TOTPEnrollment extends Omit<TOTPOptions, 'time'> {
  /**
   * The base32 secret, as `totpSecret` returns it.
   */
  secret: string;

  /**
   * The service name the app shows above the code.
   */
  issuer: string;

  /**
   * The account name the app shows beside the issuer, such as an email address.
   */
  account: string;
}

/**
 * Builds the `otpauth://totp/` URI an authenticator app enrolls from, usually shown as a QR code.
 * Parameters left at their defaults are omitted, since some apps reject any they do not expect.
 *
 * @example
 * ```ts
 * totpURI({ secret: 'JBSWY3DPEHPK3PXP', issuer: 'Acme Co', account: 'ada@example.com' })
 * // -> 'otpauth://totp/Acme%20Co:ada%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Acme%20Co'
 *
 * totpURI({ secret: 'JBSWY3DPEHPK3PXP', issuer: 'Acme', account: 'ada', digits: 8 })
 * // -> 'otpauth://totp/Acme:ada?secret=JBSWY3DPEHPK3PXP&issuer=Acme&digits=8'
 * ```
 */
export function totpURI({
  secret,
  issuer,
  account,
  algorithm = 'sha1',
  digits = 6,
  period = 30,
}: TOTPEnrollment): string {
  const params = [`secret=${secret}`, `issuer=${encodeRFC3986(issuer)}`];
  if (algorithm !== 'sha1') params.push(`algorithm=${algorithm.toUpperCase()}`);
  if (digits !== 6) params.push(`digits=${digits}`);
  if (period !== 30) params.push(`period=${period}`);
  return `otpauth://totp/${encodeRFC3986(issuer)}:${encodeRFC3986(account)}?${params.join('&')}`;
}
