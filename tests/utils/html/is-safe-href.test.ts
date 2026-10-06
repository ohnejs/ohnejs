import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isSafeHref } from '../../../src/utils/index.ts';

const ACCEPTED = [
  'https://x.y',
  'HTTP://X.Y',
  'mailto:a@b.c?subject=x',
  'tel:+1-555',
  '/',
  '/a?b#c',
  '#',
  '#top',
];

const REFUSED = [
  'javascript:alert(1)',
  'java\tscript:x',
  'JaVaScRiPt:x',
  'ｊavascript:x',
  'data:text/html,x',
  'vbscript:x',
  'blob:x',
  'file:///etc/passwd',
  '//evil.com',
  '/\\evil.com',
  '/\t/evil.com',
  'https://u:p@x.y',
  'https://x.y@evil.com',
  'https://',
  '?q',
  '',
  ' https://x.y',
  'https://x.y ',
  'https://x.y/\n',
  'https://x.y/\u0000',
];

describe('isSafeHref', () => {
  for (const value of ACCEPTED) {
    it(`accepts ${JSON.stringify(value)}`, () => {
      strictEqual(isSafeHref(value), true);
    });
  }

  for (const value of REFUSED) {
    it(`refuses ${JSON.stringify(value)}`, () => {
      strictEqual(isSafeHref(value), false);
    });
  }
});
