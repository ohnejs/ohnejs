import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { mimeTypeFor } from '../../../src/utils/index.ts';

describe('mimeTypeFor', () => {
  it('maps a file name to its content-type', () => {
    strictEqual(mimeTypeFor('photo.png'), 'image/png');
    strictEqual(mimeTypeFor('/assets/app.js'), 'text/javascript; charset=utf-8');
  });

  it('accepts a dotted or bare extension', () => {
    strictEqual(mimeTypeFor('.json'), 'application/json; charset=utf-8');
    strictEqual(mimeTypeFor('png'), 'image/png');
  });

  it('is case-insensitive', () => {
    strictEqual(mimeTypeFor('IMAGE.PNG'), 'image/png');
  });

  it('uses the last extension of a multi-dot name', () => {
    strictEqual(mimeTypeFor('archive.tar.gz'), 'application/gzip');
  });

  it('adds a charset to text types but not binary types', () => {
    strictEqual(mimeTypeFor('a.css'), 'text/css; charset=utf-8');
    strictEqual(mimeTypeFor('a.woff2'), 'font/woff2');
  });

  it('covers office, archive, and media types', () => {
    strictEqual(
      mimeTypeFor('report.docx'),
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    strictEqual(mimeTypeFor('bundle.7z'), 'application/x-7z-compressed');
    strictEqual(mimeTypeFor('clip.webm'), 'video/webm');
    strictEqual(mimeTypeFor('track.flac'), 'audio/flac');
  });

  it('returns undefined for an unknown or missing extension', () => {
    strictEqual(mimeTypeFor('archive.xyz'), undefined);
    strictEqual(mimeTypeFor('README'), undefined);
    strictEqual(mimeTypeFor('.hidden'), undefined);
  });

  it('returns undefined for an inherited key rather than the prototype', () => {
    strictEqual(mimeTypeFor('__proto__'), undefined);
    strictEqual(mimeTypeFor('toString'), undefined);
  });
});
