import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { cspHash } from '../../../src/utils/crypto/index.ts';

describe('cspHash', () => {
  it('quotes the base64 SHA-256 behind the `sha256-` prefix', () => {
    strictEqual(cspHash(''), "'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='");
    strictEqual(cspHash('alert(1);'), "'sha256-5jFwrAK0UV47oFbVg/iCCBbxD8X1w+QvoOUepu4C2YA='");
  });

  it('hashes the whitespace around a script, which the browser hashes too', () => {
    strictEqual(cspHash('\n  alert(1);\n') === cspHash('alert(1);'), false);
  });

  it('hashes the UTF-8 bytes', () => {
    strictEqual(cspHash('é'), "'sha256-SplVfkAzw1Od4utlRyAXytX5VX96BiWgnxw/biumnEw='");
  });
});
