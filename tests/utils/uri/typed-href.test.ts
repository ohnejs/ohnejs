import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isSafeHref, typedHref } from '../../../src/utils/index.ts';

/**
 * Asserts each typed value in `cases` reads as its expected href.
 */
function expectAll(cases: [typed: string, href: string | undefined][]): void {
  for (const [typed, href] of cases) strictEqual(typedHref(typed), href, typed);
}

describe('typedHref', () => {
  it('prefixes a bare host with https', () => {
    expectAll([
      ['example.com', 'https://example.com'],
      ['www.example.com', 'https://www.example.com'],
      ['sub.example.co.uk', 'https://sub.example.co.uk'],
      ['example.com/', 'https://example.com/'],
      ['example.com/a/b?c=1#d', 'https://example.com/a/b?c=1#d'],
      ['example.com?q=thrall', 'https://example.com?q=thrall'],
      ['example.com#top', 'https://example.com#top'],
      ['example.com:8080/a', 'https://example.com:8080/a'],
      ['localhost', 'https://localhost'],
      ['localhost:3000', 'https://localhost:3000'],
      ['127.0.0.1:3000', 'https://127.0.0.1:3000'],
      ['münchen.de', 'https://münchen.de'],
    ]);
  });

  it('keeps a value with a scheme as typed', () => {
    expectAll([
      ['https://example.com', 'https://example.com'],
      ['HTTP://EXAMPLE.COM', 'HTTP://EXAMPLE.COM'],
      ['mailto:thrall@orgrimmar.example', 'mailto:thrall@orgrimmar.example'],
      ['tel:+1-555', 'tel:+1-555'],
      ['ftp://example.com', 'ftp://example.com'],
      ['javascript:alert(1)', 'javascript:alert(1)'],
      ['a.b:c', 'a.b:c'],
    ]);
  });

  it('keeps a local path and a fragment', () => {
    expectAll([
      ['/', '/'],
      ['/docs', '/docs'],
      ['/a?b#c', '/a?b#c'],
      ['//evil.com', '//evil.com'],
      ['#', '#'],
      ['#top', '#top'],
    ]);
  });

  it('trims the value', () => {
    expectAll([
      [' https://x.y ', 'https://x.y'],
      ['\texample.com\n', 'https://example.com'],
      [' /docs', '/docs'],
    ]);
  });

  it('returns undefined for text that is not a URL', () => {
    expectAll([
      ['', undefined],
      ['   ', undefined],
      ['thrall', undefined],
      ['thrall jaina', undefined],
      ['example.com and more', undefined],
      ['example', undefined],
      ['example.', undefined],
      ['.com', undefined],
      ['?q=thrall', undefined],
      ['thrall@orgrimmar.example', undefined],
      ['3000:localhost', undefined],
      ['Note: Q3 plan', undefined],
      ['Re: launch', undefined],
      ['example.com/a b', undefined],
      ['/docs and more', undefined],
      ['# top', undefined],
    ]);
  });

  it('reads a URL the caller still has to check', () => {
    strictEqual(isSafeHref(typedHref('example.com') ?? ''), true);
    strictEqual(isSafeHref(typedHref('javascript:alert(1)') ?? ''), false);
    strictEqual(isSafeHref(typedHref('//evil.com') ?? ''), false);
    strictEqual(isSafeHref(typedHref('https://u:p@x.y') ?? ''), false);
  });
});
