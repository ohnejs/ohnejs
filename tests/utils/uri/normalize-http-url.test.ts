import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isHTTPURL, normalizeHTTPURL } from '../../../src/utils/index.ts';

describe('normalizeHTTPURL', () => {
  it('lowercases the scheme and host, and keeps the rest as written', () => {
    strictEqual(
      normalizeHTTPURL(' HTTPS://Dalaran.Example/A?q=B#C '),
      'https://dalaran.example/A?q=B#C',
    );
    strictEqual(normalizeHTTPURL('https://MÜNCHEN.de/Ä'), 'https://münchen.de/Ä');
    strictEqual(normalizeHTTPURL('https://ΚΑΛΟΣ-ΗΡΘΕΣ.gr'), 'https://καλοσ-ηρθεσ.gr');
  });

  it('drops a default port and a lone `/`', () => {
    strictEqual(normalizeHTTPURL('https://x.example:443/'), 'https://x.example');
    strictEqual(normalizeHTTPURL('http://x.example:80/?q=1'), 'http://x.example?q=1');
    strictEqual(normalizeHTTPURL('https://x.example/#top'), 'https://x.example#top');
    strictEqual(normalizeHTTPURL('http://x.example:443/a'), 'http://x.example:443/a');
    strictEqual(normalizeHTTPURL('https://x.example:08080/a/'), 'https://x.example:8080/a/');
  });

  it('keeps fullwidth delimiters in the host, so the result stays invalid and stable', () => {
    for (const value of [
      'https://x.example：443',
      'https://x.example／',
      'https://ｄａｌａｒａｎ.example',
    ]) {
      const stored = normalizeHTTPURL(value);
      strictEqual(normalizeHTTPURL(stored), stored, value);
      strictEqual(isHTTPURL(stored), false, value);
    }
  });

  it('only trims a value that is no web address', () => {
    strictEqual(normalizeHTTPURL(' Dalaran.example '), 'Dalaran.example');
    strictEqual(normalizeHTTPURL('mailto:A@X.example'), 'mailto:A@X.example');
  });
});
