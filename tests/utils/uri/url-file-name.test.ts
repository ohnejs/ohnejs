import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { urlFileName } from '../../../src/utils/index.ts';

/**
 * Asserts each URL in `cases` yields its expected file name.
 */
function expectAll(cases: [url: URL | string, name: string][]): void {
  for (const [url, name] of cases) strictEqual(urlFileName(url), name, String(url));
}

describe('urlFileName', () => {
  it('returns the last path segment', () => {
    expectAll([
      ['https://cdn.example/thrall/axe.png', 'axe.png'],
      ['https://cdn.example/axe.png', 'axe.png'],
      ['http://cdn.example:8080/a/b/c/Doomhammer', 'Doomhammer'],
      [new URL('https://cdn.example/jaina/staff.webp'), 'staff.webp'],
    ]);
  });

  it('skips empty trailing segments', () => {
    expectAll([
      ['https://cdn.example/sylvanas/', 'sylvanas'],
      ['https://cdn.example/sylvanas//', 'sylvanas'],
      ['https://cdn.example/a//sylvanas.png', 'sylvanas.png'],
    ]);
  });

  it('percent-decodes the segment as UTF-8', () => {
    expectAll([
      ['https://cdn.example/Jaina%20Proudmoore.png', 'Jaina Proudmoore.png'],
      ['https://cdn.example/Sch%C3%B6ne%20Gr%C3%BC%C3%9Fe.PNG', 'Schöne Grüße.PNG'],
      ['https://cdn.example/Jaina Proudmoore.png', 'Jaina Proudmoore.png'],
      ['https://cdn.example/фото.jpg', 'фото.jpg'],
    ]);
  });

  it('keeps the raw text of a segment with a malformed escape', () => {
    expectAll([
      ['https://cdn.example/%E0%A4%A.png', '%E0%A4%A.png'],
      ['https://cdn.example/100%.png', '100%.png'],
      ['https://cdn.example/%FF.png', '%FF.png'],
    ]);
  });

  it('cuts path parameters at the first `;`', () => {
    expectAll([
      ['https://cdn.example/img.jpg;jsessionid=SECRET123', 'img.jpg'],
      ['https://cdn.example/a;v=1/b.png;v=2;w=3', 'b.png'],
      ['https://cdn.example/thrall.png/;jsessionid=SECRET123', 'thrall.png'],
    ]);
  });

  it('decodes an escaped `;` into the name instead of cutting there', () => {
    expectAll([['https://cdn.example/thrall%3Bjaina.png', 'thrall;jaina.png']]);
  });

  it('returns an escaped traversal raw, for the caller to sanitize', () => {
    expectAll([
      ['https://cdn.example/a/b%2F..%2F..%2Fetc%2Fpasswd', 'b/../../etc/passwd'],
      ['https://cdn.example/a/..%5C..%5Cwin.ini', '..\\..\\win.ini'],
    ]);
  });

  it('never reads the query, the fragment or the userinfo', () => {
    expectAll([
      ['https://cdn.example/photo.jpg?X-Amz-Signature=SECRET', 'photo.jpg'],
      ['https://cdn.example/photo?name=evil.html', 'photo'],
      ['https://cdn.example/photo#/evil.html', 'photo'],
      ['https://thrall:secret@cdn.example/', ''],
      ['https://thrall:secret@cdn.example/?file=axe.png#axe.png', ''],
    ]);
  });

  it('returns an empty string when the path names no segment', () => {
    expectAll([
      ['https://cdn.example/', ''],
      ['https://cdn.example', ''],
      ['https://cdn.example//', ''],
      ['https://cdn.example/;jsessionid=SECRET123', ''],
      ['https://cdn.example/a/..', ''],
    ]);
  });

  it('returns an empty string for a string no URL parser accepts', () => {
    expectAll([
      ['', ''],
      ['not a url', ''],
      ['/relative/axe.png', ''],
      ['https://', ''],
    ]);
  });
});
