import type { CBORMap } from '../cbor/decode-cbor.ts';

import { readCBOR } from '../cbor/_read-cbor.ts';
import { isMap } from '../is/is-map.ts';

/**
 * The flags byte of authenticator data.
 */
export interface AuthenticatorFlags {
  /**
   * The user touched or otherwise confirmed the authenticator (UP).
   */
  userPresent: boolean;

  /**
   * The authenticator verified the user, by biometrics or a PIN (UV).
   */
  userVerified: boolean;

  /**
   * The credential may be synced to other devices, such as an iCloud Keychain passkey (BE).
   */
  backupEligible: boolean;

  /**
   * The credential is synced right now (BS).
   */
  backedUp: boolean;

  /**
   * The data carries `credential` (AT).
   */
  attestedCredentialData: boolean;

  /**
   * The data carries `extensions` (ED).
   */
  extensionData: boolean;
}

/**
 * The credential a registration creates.
 */
export interface AttestedCredential {
  /**
   * The authenticator model as a UUID, all zeros when the authenticator withholds it.
   */
  aaguid: string;

  /**
   * The credential id.
   */
  id: Uint8Array;

  /**
   * The credential public key as COSE, for `coseToJWK`.
   */
  publicKey: CBORMap;
}

/**
 * Authenticator data, split into its fields.
 */
export interface AuthenticatorData {
  /**
   * SHA-256 of the RP ID the credential is scoped to.
   */
  rpIDHash: Uint8Array;

  /**
   * The flags byte.
   */
  flags: AuthenticatorFlags;

  /**
   * The signature counter.
   * Synced passkeys report `0` on every use.
   */
  signCount: number;

  /**
   * The new credential, present only on registration.
   */
  credential?: AttestedCredential;

  /**
   * Authenticator extension outputs.
   */
  extensions?: CBORMap;
}

const MIN_LENGTH = 37;
const MAX_CREDENTIAL_ID = 1023;

/**
 * Parses WebAuthn authenticator data.
 * A length that does not match its flags, or `BS` without `BE`, throws.
 *
 * @example
 * ```ts
 * const data = parseAuthenticatorData(authData)
 * data.flags.userVerified // -> true
 * data.signCount          // -> 0
 * data.credential?.aaguid // -> '00000000-0000-0000-0000-000000000000'
 * ```
 */
export function parseAuthenticatorData(bytes: Uint8Array): AuthenticatorData {
  if (bytes.byteLength < MIN_LENGTH) throw new Error('Authenticator data is too short');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const bits = bytes[32];
  const flags: AuthenticatorFlags = {
    userPresent: (bits & 0x01) !== 0,
    userVerified: (bits & 0x04) !== 0,
    backupEligible: (bits & 0x08) !== 0,
    backedUp: (bits & 0x10) !== 0,
    attestedCredentialData: (bits & 0x40) !== 0,
    extensionData: (bits & 0x80) !== 0,
  };
  if (flags.backedUp && !flags.backupEligible) {
    throw new Error('Authenticator data is backed up but not backup eligible');
  }

  const data: AuthenticatorData = {
    rpIDHash: bytes.slice(0, 32),
    flags,
    signCount: view.getUint32(33),
  };
  let at = MIN_LENGTH;

  if (flags.attestedCredentialData) {
    if (bytes.byteLength < at + 18) throw new Error('Authenticator data is too short');
    const aaguid = bytes.subarray(at, at + 16).toHex();
    const length = view.getUint16(at + 16);
    at += 18;
    if (length > MAX_CREDENTIAL_ID || at + length > bytes.byteLength) {
      throw new Error('Invalid credential id length');
    }
    const id = bytes.slice(at, at + length);
    const key = readCBOR(bytes, at + length, 16);
    if (!isMap<CBORMap>(key.value)) throw new Error('Credential public key is not a COSE key');
    data.credential = { aaguid: formatUUID(aaguid), id, publicKey: key.value };
    at = key.end;
  }

  if (flags.extensionData) {
    const extensions = readCBOR(bytes, at, 16);
    if (!isMap<CBORMap>(extensions.value)) {
      throw new Error('Authenticator extensions are not a map');
    }
    data.extensions = extensions.value;
    at = extensions.end;
  }

  if (at !== bytes.byteLength) throw new Error('Trailing bytes after authenticator data');
  return data;
}

/**
 * Formats 32 hex digits as a dashed UUID.
 */
function formatUUID(hex: string): string {
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
