import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isOrigin } from '../../../src/utils/index.ts';

describe('isOrigin', () => {
  it('accepts serialized http(s) origins', () => {
    strictEqual(isOrigin('https://example.com'), true);
    strictEqual(isOrigin('http://localhost:3000'), true);
    strictEqual(isOrigin('http://127.0.0.1:3000'), true);
    strictEqual(isOrigin('https://preview.ohne.dev'), true);
  });

  it('rejects anything a browser would serialize differently', () => {
    strictEqual(isOrigin('https://example.com/'), false);
    strictEqual(isOrigin('https://example.com/admin'), false);
    strictEqual(isOrigin('https://Example.com'), false);
    strictEqual(isOrigin('https://example.com:443'), false);
    strictEqual(isOrigin('https://user@example.com'), false);
  });

  it('rejects characters that would break or widen a header list', () => {
    strictEqual(isOrigin('https://a.dev;script-src'), false);
    strictEqual(isOrigin('https://a,b.dev'), false);
    strictEqual(isOrigin("https://a'b.dev"), false);
    strictEqual(isOrigin('https://*'), false);
    strictEqual(isOrigin('https://*.example.com'), false);
  });

  it('rejects other schemes, keywords, empty labels and IPv6', () => {
    strictEqual(isOrigin('ws://example.com'), false);
    strictEqual(isOrigin('file:///etc'), false);
    strictEqual(isOrigin("'self'"), false);
    strictEqual(isOrigin('https://ohne.dev.'), false);
    strictEqual(isOrigin('https://..'), false);
    strictEqual(isOrigin('https://[::1]:3000'), false);
  });

  it('rejects non-strings', () => {
    strictEqual(isOrigin(''), false);
    strictEqual(isOrigin(undefined), false);
    strictEqual(isOrigin(42), false);
  });
});
