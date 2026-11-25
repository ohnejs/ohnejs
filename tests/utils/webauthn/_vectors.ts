import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from '../../../src/utils/index.ts';

interface RawVector {
  registration: Record<
    'challenge' | 'credential_id' | 'clientDataJSON' | 'attestationObject',
    string
  >;
  authentication: Record<
    'challenge' | 'authenticatorData' | 'clientDataJSON' | 'signature',
    string
  >;
}

/**
 * A WebAuthn Level 3 test vector pair, decoded into what a browser would post.
 */
export interface Vector {
  registration: { challenge: string; response: RegistrationResponseJSON };
  authentication: { challenge: string; response: AuthenticationResponseJSON };
}

const raw: Record<string, RawVector> = JSON.parse(
  readFileSync(join(import.meta.dirname, 'fixtures/spec-vectors.json'), 'utf8'),
);

const b64 = (hex: string) =>
  Uint8Array.fromHex(hex).toBase64({ alphabet: 'base64url', omitPadding: true });

/**
 * The expectation every spec vector was generated for.
 */
export const SPEC = { origin: 'https://example.org', rpID: 'example.org' };

/**
 * The spec vector named `name`, from the "Test Vectors" section of WebAuthn Level 3.
 */
export function vector(name: string): Vector {
  const { registration, authentication } = raw[name];
  const id = b64(registration.credential_id);
  return {
    registration: {
      challenge: b64(registration.challenge),
      response: {
        id,
        type: 'public-key',
        response: {
          clientDataJSON: b64(registration.clientDataJSON),
          attestationObject: b64(registration.attestationObject),
        },
      },
    },
    authentication: {
      challenge: b64(authentication.challenge),
      response: {
        id,
        type: 'public-key',
        response: {
          clientDataJSON: b64(authentication.clientDataJSON),
          authenticatorData: b64(authentication.authenticatorData),
          signature: b64(authentication.signature),
        },
      },
    },
  };
}
