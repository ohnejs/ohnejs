import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { signJWT } from '../../../src/utils/crypto/index.ts';

const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString());

describe('signJWT', () => {
  it('matches the jwt.io HS256 sample', () => {
    strictEqual(
      signJWT({ sub: '1234567890', name: 'John Doe', iat: 1516239022 }, 'your-256-bit-secret'),
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
    );
  });

  it('carries the HS256 header and the payload as given', () => {
    const [header, payload] = signJWT({ room: 'thrall', exp: 1 }, 'secret').split('.');
    strictEqual(JSON.stringify(decode(header!)), '{"alg":"HS256","typ":"JWT"}');
    strictEqual(JSON.stringify(decode(payload!)), '{"room":"thrall","exp":1}');
  });

  it('accepts raw key bytes', () => {
    const secret = 'your-256-bit-secret';
    strictEqual(signJWT({}, new TextEncoder().encode(secret)), signJWT({}, secret));
  });
});
