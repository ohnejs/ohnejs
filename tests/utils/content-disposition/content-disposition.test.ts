import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { contentDisposition } from '../../../src/utils/content-disposition/content-disposition.ts';

describe('contentDisposition', () => {
  it('defaults to attachment with a quoted filename', () => {
    strictEqual(contentDisposition('report.pdf'), 'attachment; filename="report.pdf"');
  });

  it('uses inline when asked', () => {
    strictEqual(
      contentDisposition('report.pdf', { inline: true }),
      'inline; filename="report.pdf"',
    );
  });

  it('adds a UTF-8 filename* for a non-ASCII name', () => {
    strictEqual(
      contentDisposition('Übersicht.pdf'),
      'attachment; filename="?bersicht.pdf"; filename*=UTF-8\'\'%C3%9Cbersicht.pdf',
    );
  });

  it('replaces each non-ASCII code point with one question mark', () => {
    strictEqual(
      contentDisposition('日本.txt'),
      'attachment; filename="??.txt"; filename*=UTF-8\'\'%E6%97%A5%E6%9C%AC.txt',
    );
    strictEqual(
      contentDisposition('📷.jpg'),
      'attachment; filename="?.jpg"; filename*=UTF-8\'\'%F0%9F%93%B7.jpg',
    );
  });

  it('escapes quotes and backslashes in the fallback', () => {
    strictEqual(contentDisposition('a"b\\c.txt'), 'attachment; filename="a\\"b\\\\c.txt"');
  });

  it('drops control characters from both parameters', () => {
    strictEqual(contentDisposition('re\r\nport\u0000.pdf'), 'attachment; filename="report.pdf"');
    strictEqual(
      contentDisposition('Ü\u0007.pdf'),
      'attachment; filename="?.pdf"; filename*=UTF-8\'\'%C3%9C.pdf',
    );
  });

  it('percent-encodes every byte outside the RFC 8187 attr-char set', () => {
    strictEqual(
      contentDisposition("é*'() ;=,.txt"),
      "attachment; filename=\"?*'() ;=,.txt\"; filename*=UTF-8''%C3%A9%2A%27%28%29%20%3B%3D%2C.txt",
    );
  });

  it('keeps attr-char bytes bare in filename*', () => {
    strictEqual(
      contentDisposition('é!#$&+-.^_`|~.txt'),
      'attachment; filename="?!#$&+-.^_`|~.txt"; filename*=UTF-8\'\'%C3%A9!#$&+-.^_`|~.txt',
    );
  });

  it('encodes a lone surrogate as the replacement character instead of throwing', () => {
    strictEqual(
      contentDisposition('a\uD800b.txt'),
      'attachment; filename="a?b.txt"; filename*=UTF-8\'\'a%EF%BF%BDb.txt',
    );
  });

  it('leaves a plain ASCII name without filename*', () => {
    strictEqual(contentDisposition("it's (1).txt"), 'attachment; filename="it\'s (1).txt"');
  });
});
