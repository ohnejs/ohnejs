import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import {
  contentDisposition,
  parseContentDisposition,
  type ContentDisposition,
} from '../../../src/utils/index.ts';

/**
 * Asserts each header in `cases` parses to its expected disposition.
 */
function expectAll(cases: [header: string, expected: ContentDisposition][]): void {
  for (const [header, expected] of cases) {
    deepStrictEqual(parseContentDisposition(header), expected, header);
  }
}

describe('parseContentDisposition', () => {
  it('reads the RFC 6266 examples', () => {
    expectAll([
      ['Attachment; filename=example.html', { type: 'attachment', filename: 'example.html' }],
      ['INLINE; FILENAME= "an example.html"', { type: 'inline', filename: 'an example.html' }],
      [
        `attachment; filename*= UTF-8''%e2%82%ac%20rates`,
        { type: 'attachment', filename: '€ rates' },
      ],
      [
        `attachment; filename="EURO rates"; filename*=utf-8''%e2%82%ac%20rates`,
        { type: 'attachment', filename: '€ rates' },
      ],
    ]);
  });

  it('decodes a UTF-8 `filename*`', () => {
    expectAll([
      [
        `attachment; filename*=UTF-8''%E2%82%AC%20rates.pdf`,
        { type: 'attachment', filename: '€ rates.pdf' },
      ],
      [`attachment; filename*=UTF-8''Thrall.png`, { type: 'attachment', filename: 'Thrall.png' }],
      [`inline; filename*=UTF-8''%F0%9F%90%BA.png`, { type: 'inline', filename: '🐺.png' }],
    ]);
  });

  it('lets `filename*` win over `filename` in either order', () => {
    expectAll([
      [
        `attachment; filename="thrall.png"; filename*=UTF-8''%C3%9Cbersicht.png`,
        { type: 'attachment', filename: 'Übersicht.png' },
      ],
      [
        `attachment; filename*=UTF-8''%C3%9Cbersicht.png; filename="thrall.png"`,
        { type: 'attachment', filename: 'Übersicht.png' },
      ],
    ]);
  });

  it('decodes `filename*` in its charset, whatever its case', () => {
    expectAll([
      [
        `attachment; filename*=iso-8859-1'en'%A3%20rates`,
        { type: 'attachment', filename: '£ rates' },
      ],
      [
        `attachment; filename*=ISO-8859-1''J%E4ina.png`,
        { type: 'attachment', filename: 'Jäina.png' },
      ],
      [`attachment; filename*=Utf-8''Jaina.png`, { type: 'attachment', filename: 'Jaina.png' }],
    ]);
  });

  it('ignores the language tag', () => {
    expectAll([
      [
        `attachment; filename*=UTF-8'de-AT'%C3%9Cbersicht.pdf`,
        { type: 'attachment', filename: 'Übersicht.pdf' },
      ],
      [
        `attachment; filename*=UTF-8'en'Sylvanas.png`,
        { type: 'attachment', filename: 'Sylvanas.png' },
      ],
    ]);
  });

  it('falls back to `filename` when `filename*` is malformed', () => {
    const fallback = { type: 'attachment', filename: 'arthas.png' };
    expectAll([
      [`attachment; filename="arthas.png"; filename*=UTF-8''%E0%A4%A.html`, fallback],
      [`attachment; filename="arthas.png"; filename*=UTF-8''100%.html`, fallback],
      [`attachment; filename="arthas.png"; filename*=UTF-8''%FF.html`, fallback],
      [`attachment; filename="arthas.png"; filename*=UTF-8''%C3.html`, fallback],
      [`attachment; filename="arthas.png"; filename*=klingon''x.html`, fallback],
      [`attachment; filename="arthas.png"; filename*=''x.html`, fallback],
      [`attachment; filename="arthas.png"; filename*=UTF-8'x.html`, fallback],
      [`attachment; filename="arthas.png"; filename*=x.html`, fallback],
      [`attachment; filename="arthas.png"; filename*=UTF-8''Ã¼.html`, fallback],
      [`attachment; filename="arthas.png"; filename*=UTF-8''`, fallback],
    ]);
  });

  it('omits the file name when a malformed `filename*` has no fallback', () => {
    expectAll([
      [`attachment; filename*=UTF-8''%E0%A4%A.html`, { type: 'attachment' }],
      [`attachment; filename*=klingon''x.html`, { type: 'attachment' }],
    ]);
  });

  it('matches the disposition type and parameter names case-insensitively', () => {
    expectAll([
      ['ATTACHMENT; FILENAME="Illidan.png"', { type: 'attachment', filename: 'Illidan.png' }],
      [`Inline; FILENAME*=UTF-8''Illidan.png`, { type: 'inline', filename: 'Illidan.png' }],
      ['attachment; FileName=Illidan.png', { type: 'attachment', filename: 'Illidan.png' }],
    ]);
  });

  it('unwraps quoted strings with their escapes', () => {
    expectAll([
      ['attachment; filename="\\"Thrall\\".png"', { type: 'attachment', filename: '"Thrall".png' }],
      [
        'attachment; filename="thrall\\\\jaina.png"',
        { type: 'attachment', filename: 'thrall\\jaina.png' },
      ],
      [
        'attachment; filename="thrall; jaina.png"',
        { type: 'attachment', filename: 'thrall; jaina.png' },
      ],
      [
        'attachment; filename="Jaina Proudmoore.png"',
        { type: 'attachment', filename: 'Jaina Proudmoore.png' },
      ],
    ]);
  });

  it('returns a traversal or control-bearing name raw, for the caller to sanitize', () => {
    expectAll([
      [
        'attachment; filename="../../etc/passwd"',
        { type: 'attachment', filename: '../../etc/passwd' },
      ],
      [
        'inline; FILENAME="../../../../etc/cron.d/x.sh"',
        { type: 'inline', filename: '../../../../etc/cron.d/x.sh' },
      ],
      [
        `attachment; filename*=UTF-8''..%2F..%2Fetc%2Fpasswd`,
        { type: 'attachment', filename: '../../etc/passwd' },
      ],
      [
        `attachment; filename="a.jpg"; filename*=UTF-8''%E2%80%AEgpj.html%00.jpg`,
        { type: 'attachment', filename: '‮gpj.html\u0000.jpg' },
      ],
    ]);
  });

  it('keeps the first of duplicate parameters and joined headers', () => {
    expectAll([
      [
        'attachment; filename="thrall.png"; filename="jaina.png"',
        { type: 'attachment', filename: 'thrall.png' },
      ],
      [
        'attachment; filename="thrall.png", attachment; filename="jaina.html"',
        { type: 'attachment', filename: 'thrall.png' },
      ],
    ]);
  });

  it('omits an empty file name', () => {
    expectAll([
      ['attachment; filename=""', { type: 'attachment' }],
      ['attachment; filename=', { type: 'attachment' }],
      ['attachment; filename*=', { type: 'attachment' }],
      [`attachment; filename*=UTF-8''; filename=""`, { type: 'attachment' }],
    ]);
  });

  it('reads a header with no file name', () => {
    expectAll([
      ['attachment', { type: 'attachment' }],
      ['inline', { type: 'inline' }],
      ['', { type: '' }],
      ['attachment; size=42', { type: 'attachment' }],
    ]);
  });

  it('never lets a `__proto__` parameter reach the result', () => {
    const parsed = parseContentDisposition('attachment; __proto__=x; filename="thrall.png"');
    deepStrictEqual(parsed, { type: 'attachment', filename: 'thrall.png' });
    strictEqual(Object.getPrototypeOf(parsed), Object.prototype);
  });

  it('never throws on garbage', () => {
    expectAll([
      [';;;', { type: '' }],
      ['=', { type: '=' }],
      ['"""', { type: '"""' }],
      ['attachment; filename', { type: 'attachment' }],
      ['attachment; =thrall.png', { type: 'attachment' }],
      ['attachment; filename="unterminated', { type: 'attachment', filename: 'unterminated' }],
      ['attachment; filename="trailing\\', { type: 'attachment', filename: 'trailing\\' }],
    ]);

    const alphabet = [`'`, '"', '%', ';', '=', '*', '\\', ' ', 'E', '2'];
    const tails = alphabet.flatMap((a) => alphabet.flatMap((b) => alphabet.map((c) => a + b + c)));
    const heads = [
      `attachment; filename*=UTF-8''`,
      'attachment; filename=',
      'attachment; filename*=',
    ];
    for (const header of heads.flatMap((head) => tails.map((tail) => head + tail))) {
      strictEqual(parseContentDisposition(header).type, 'attachment', header);
    }
  });

  it('round-trips every name `contentDisposition` writes', () => {
    for (const name of [
      'thrall.png',
      'Übersicht.pdf',
      '€ rates.pdf',
      '日本.txt',
      '📷.jpg',
      'a"b\\c.txt',
      "it's.png",
    ]) {
      deepStrictEqual(parseContentDisposition(contentDisposition(name)), {
        type: 'attachment',
        filename: name,
      });
      deepStrictEqual(parseContentDisposition(contentDisposition(name, { inline: true })), {
        type: 'inline',
        filename: name,
      });
    }
  });
});
