import { decodeBase64URL } from '../base64url/decode-base64url.ts';
import { isPlainObject } from '../is/is-plain-object.ts';
import { isString } from '../is/is-string.ts';
import { decodeText } from '../text/decode-text.ts';

/**
 * What the client data of a ceremony must hold.
 */
export interface ExpectedClientData {
  type: 'webauthn.create' | 'webauthn.get';
  challenge: string;
  origin: string | readonly string[];
}

/**
 * Checks `clientDataJSON` against the ceremony the server started, and returns its SHA-256.
 */
export async function checkClientData(
  clientDataJSON: Uint8Array<ArrayBuffer>,
  expected: ExpectedClientData,
): Promise<Uint8Array<ArrayBuffer>> {
  const data: unknown = JSON.parse(decodeText(clientDataJSON));
  if (!isPlainObject(data)) throw new Error('Client data is not an object');
  if (data.type !== expected.type) throw new Error(`Client data type is not \`${expected.type}\``);
  if (
    !isString(data.challenge) ||
    decodeBase64URL(data.challenge).toHex() !== decodeBase64URL(expected.challenge).toHex()
  ) {
    throw new Error('Client data challenge does not match');
  }
  const origins = isString(expected.origin) ? [expected.origin] : expected.origin;
  if (!isString(data.origin) || !origins.includes(data.origin)) {
    throw new Error('Client data origin is not allowed');
  }
  if (data.crossOrigin === true) throw new Error('Client data is cross-origin');
  return new Uint8Array(await crypto.subtle.digest('SHA-256', clientDataJSON));
}
