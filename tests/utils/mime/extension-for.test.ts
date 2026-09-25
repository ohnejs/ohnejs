import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { extensionFor, extname, mimeTypeFor } from '../../../src/utils/index.ts';
import { MIME_TYPES } from '../../../src/utils/mime/_mime-types.ts';

describe('extensionFor', () => {
  it('maps a content-type to its extension', () => {
    const cases: [type: string, extension: string][] = [
      ['image/png', '.png'],
      ['image/webp', '.webp'],
      ['application/pdf', '.pdf'],
      ['video/webm', '.webm'],
      ['font/woff2', '.woff2'],
      ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.docx'],
    ];
    for (const [type, extension] of cases) strictEqual(extensionFor(type), extension, type);
  });

  it('picks the first extension the table lists for a shared type', () => {
    const cases: [type: string, extension: string][] = [
      ['image/jpeg', '.jpg'],
      ['image/tiff', '.tif'],
      ['text/html', '.html'],
      ['text/plain', '.txt'],
      ['text/markdown', '.md'],
      ['text/javascript', '.js'],
      ['application/json', '.json'],
      ['application/yaml', '.yaml'],
      ['application/gzip', '.gz'],
      ['audio/ogg', '.ogg'],
      ['audio/midi', '.mid'],
      ['video/mp4', '.mp4'],
      ['video/mpeg', '.mpeg'],
    ];
    for (const [type, extension] of cases) strictEqual(extensionFor(type), extension, type);
  });

  it('ignores parameters, case and surrounding whitespace', () => {
    strictEqual(extensionFor('text/html; charset=utf-8'), '.html');
    strictEqual(extensionFor('image/svg+xml; charset=utf-8'), '.svg');
    strictEqual(extensionFor('IMAGE/PNG; q=1'), '.png');
    strictEqual(extensionFor('  Image/Jpeg  '), '.jpg');
  });

  it('returns the dotted form `extname` reads back from an appended name', () => {
    const extension = extensionFor('image/png')!;
    strictEqual(extname(`thrall${extension}`), extension);
  });

  it('inverts every type in the table back to an extension of that type', () => {
    for (const type of Object.values(MIME_TYPES)) {
      strictEqual(mimeTypeFor(extensionFor(type)!), type, type);
    }
  });

  it('returns undefined for a type the table does not know', () => {
    for (const type of [
      'application/octet-stream',
      'text/xml',
      'image/x-thrall',
      'image',
      'image/',
    ]) {
      strictEqual(extensionFor(type), undefined, type);
    }
  });

  it('returns undefined for empty or garbage input', () => {
    for (const type of ['', ';', ' ; charset=utf-8', '../../etc/passwd', 'x/../../y']) {
      strictEqual(extensionFor(type), undefined, type);
    }
  });

  it('returns undefined for an inherited key rather than the prototype', () => {
    for (const type of ['__proto__', 'toString', 'constructor', 'hasOwnProperty']) {
      strictEqual(extensionFor(type), undefined, type);
    }
  });
});
