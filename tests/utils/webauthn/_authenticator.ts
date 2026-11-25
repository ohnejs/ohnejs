import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';

import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from '../../../src/utils/index.ts';

type CBORInput = number | string | Uint8Array | CBORInput[] | Map<number | string, CBORInput>;

/**
 * The authenticator data flag bits.
 */
export const FLAG = { UP: 0x01, UV: 0x04, BE: 0x08, BS: 0x10, AT: 0x40, ED: 0x80 };

/**
 * A minimal definite-length CBOR encoder, enough to build attestation objects.
 */
export function encodeCBOR(value: CBORInput): Uint8Array {
  const head = (major: number, n: number): number[] => {
    if (n < 24) return [(major << 5) | n];
    if (n < 0x100) return [(major << 5) | 24, n];
    if (n < 0x10000) return [(major << 5) | 25, n >> 8, n & 0xff];
    return [(major << 5) | 26, n >>> 24, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
  };
  if (typeof value === 'number') {
    return Uint8Array.from(value < 0 ? head(1, -1 - value) : head(0, value));
  }
  if (typeof value === 'string') {
    const bytes = new TextEncoder().encode(value);
    return Uint8Array.from([...head(3, bytes.byteLength), ...bytes]);
  }
  if (value instanceof Uint8Array) return Uint8Array.from([...head(2, value.byteLength), ...value]);
  if (Array.isArray(value)) {
    return Uint8Array.from([
      ...head(4, value.length),
      ...value.flatMap((item) => [...encodeCBOR(item)]),
    ]);
  }
  const entries = [...value].flatMap(([k, v]) => [...encodeCBOR(k), ...encodeCBOR(v)]);
  return Uint8Array.from([...head(5, value.size), ...entries]);
}

/**
 * Encodes `bytes` as unpadded base64url.
 */
export const b64 = (bytes: Uint8Array) =>
  bytes.toBase64({ alphabet: 'base64url', omitPadding: true });

const sha256 = (data: Uint8Array | string) =>
  new Uint8Array(createHash('sha256').update(data).digest());

const concat = (...parts: Uint8Array[]) => Uint8Array.from(parts.flatMap((part) => [...part]));

/**
 * A software P-256 authenticator that answers like Safari with an iCloud Keychain passkey.
 * It sets BE and BS, sends an all-zero AAGUID, keeps the counter at `0`, and omits `crossOrigin`.
 */
export function fakePasskey(rpID = 'example.com', origin = 'https://example.com') {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const id = new Uint8Array(randomBytes(20));
  const cose = new Map<number, CBORInput>([
    [1, 2],
    [3, -7],
    [-1, 1],
    [-2, Uint8Array.fromBase64(jwk.x!, { alphabet: 'base64url' })],
    [-3, Uint8Array.fromBase64(jwk.y!, { alphabet: 'base64url' })],
  ]);

  const authData = (flags: number, signCount: number, credential?: Uint8Array) => {
    const counter = new Uint8Array(4);
    new DataView(counter.buffer).setUint32(0, signCount);
    return concat(sha256(rpID), Uint8Array.of(flags), counter, credential ?? new Uint8Array());
  };
  const clientData = (type: string, challenge: string) =>
    new TextEncoder().encode(JSON.stringify({ type, challenge, origin }));

  return {
    id: b64(id),
    privateKey,

    register(
      challenge: string,
      { flags = FLAG.UP | FLAG.UV | FLAG.BE | FLAG.BS | FLAG.AT, signCount = 0 } = {},
    ): RegistrationResponseJSON {
      const length = Uint8Array.of(id.byteLength >> 8, id.byteLength & 0xff);
      const credential = concat(new Uint8Array(16), length, id, encodeCBOR(cose));
      const attestationObject = new Map<string, CBORInput>([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', authData(flags, signCount, flags & FLAG.AT ? credential : undefined)],
      ]);
      return {
        id: b64(id),
        type: 'public-key',
        response: {
          clientDataJSON: b64(clientData('webauthn.create', challenge)),
          attestationObject: b64(encodeCBOR(attestationObject)),
        },
      };
    },

    authenticate(
      challenge: string,
      { flags = FLAG.UP | FLAG.UV | FLAG.BE | FLAG.BS, signCount = 0 } = {},
    ): AuthenticationResponseJSON {
      const data = authData(flags, signCount);
      const client = clientData('webauthn.get', challenge);
      const signature = sign('sha256', concat(data, sha256(client)), {
        key: privateKey,
        dsaEncoding: 'der',
      });
      return {
        id: b64(id),
        type: 'public-key',
        response: {
          clientDataJSON: b64(client),
          authenticatorData: b64(data),
          signature: b64(new Uint8Array(signature)),
        },
      };
    },
  };
}
