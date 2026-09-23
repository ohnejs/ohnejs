import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { encodeRFC3986 } from '../../../src/utils/index.ts';

describe('encodeRFC3986', () => {
  it('leaves the unreserved characters literal', () => {
    strictEqual(encodeRFC3986('AZaz09-._~'), 'AZaz09-._~');
  });

  it('encodes the characters encodeURIComponent leaves alone', () => {
    strictEqual(encodeRFC3986("!'()*"), '%21%27%28%29%2A');
  });

  it('encodes spaces, slashes, and reserved delimiters', () => {
    strictEqual(encodeRFC3986('a b/c?d=e&f+g'), 'a%20b%2Fc%3Fd%3De%26f%2Bg');
  });

  it('encodes non-ASCII as UTF-8 bytes', () => {
    strictEqual(encodeRFC3986('é'), '%C3%A9');
  });
});
