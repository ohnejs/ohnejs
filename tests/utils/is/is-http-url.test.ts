import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isHTTPURL } from '../../../src/utils/index.ts';

describe('isHTTPURL', () => {
  it('returns true for absolute web addresses', () => {
    strictEqual(isHTTPURL('https://dalaran.example'), true);
    strictEqual(isHTTPURL('http://dalaran.example:8080/a?b=1#c'), true);
    strictEqual(isHTTPURL('HTTPS://DALARAN.EXAMPLE'), true);
    strictEqual(isHTTPURL('https://münchen.de/Ä'), true);
  });

  it('returns false for an address a browser would repair', () => {
    strictEqual(isHTTPURL('https:dalaran.example'), false);
    strictEqual(isHTTPURL('https:\\\\dalaran.example'), false);
    strictEqual(isHTTPURL('//dalaran.example'), false);
    strictEqual(isHTTPURL('https://dalaran.example/a b'), false);
    strictEqual(isHTTPURL('https://dalaran​.example'), false);
    strictEqual(isHTTPURL('https://ｅｘａｍｐｌｅ.com'), false);
  });

  it('returns false for userinfo, even behind a backslash', () => {
    strictEqual(isHTTPURL('https://thrall:x@dalaran.example'), false);
    strictEqual(isHTTPURL('https://dalaran.example\\@evil.example'), false);
  });

  it('returns false for an IP or local host', () => {
    strictEqual(isHTTPURL('https://127.0.0.1'), false);
    strictEqual(isHTTPURL('https://0x7f.0x1'), false);
    strictEqual(isHTTPURL('https://[::1]/'), false);
    strictEqual(isHTTPURL('https://localhost:3000'), false);
  });

  it('returns false for a bad port and another scheme', () => {
    strictEqual(isHTTPURL('https://dalaran.example:99999'), false);
    strictEqual(isHTTPURL('https://dalaran.example:'), false);
    strictEqual(isHTTPURL('ftp://dalaran.example'), false);
    strictEqual(isHTTPURL('mailto:a@dalaran.example'), false);
    strictEqual(isHTTPURL(42), false);
  });
});
