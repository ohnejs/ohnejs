import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isFetchableURL } from '../../../src/utils/uri/is-fetchable-url.ts';

describe('isFetchableURL', () => {
  it('accepts an http or https URL', () => {
    strictEqual(isFetchableURL(new URL('https://dalaran.example/jaina.png')), true);
    strictEqual(isFetchableURL(new URL('http://127.0.0.1:8080/?q=1#top')), true);
    strictEqual(isFetchableURL(new URL('HTTPS://DALARAN.EXAMPLE/')), true);
  });

  it('refuses every other scheme', () => {
    const urls = [
      'file:///etc/passwd',
      'ftp://dalaran.example/',
      'data:,Thrall',
      'javascript:alert(1)',
      'ws://dalaran.example/',
      'blob:https://dalaran.example/uuid',
    ];
    for (const url of urls) strictEqual(isFetchableURL(new URL(url)), false, url);
  });

  it('refuses userinfo, a user or a password alone included', () => {
    const urls = [
      'https://arthas:frostmourne@dalaran.example/',
      'https://arthas@dalaran.example/',
      'https://:frostmourne@dalaran.example/',
    ];
    for (const url of urls) strictEqual(isFetchableURL(new URL(url)), false, url);
  });
});
