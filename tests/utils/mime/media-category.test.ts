import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { MEDIA_CATEGORIES, mediaCategory } from '../../../src/utils/mime/media-category.ts';

describe('MEDIA_CATEGORIES', () => {
  it('lists every category once, in display order', () => {
    deepStrictEqual(MEDIA_CATEGORIES, [
      'image',
      'video',
      'audio',
      'document',
      'archive',
      'font',
      'text',
      'code',
      'other',
    ]);
  });
});

describe('mediaCategory', () => {
  it('maps image, video, audio, and font types by prefix', () => {
    strictEqual(mediaCategory('image/png'), 'image');
    strictEqual(mediaCategory('image/svg+xml'), 'image');
    strictEqual(mediaCategory('video/mp4'), 'video');
    strictEqual(mediaCategory('video/x-matroska'), 'video');
    strictEqual(mediaCategory('audio/mpeg'), 'audio');
    strictEqual(mediaCategory('audio/ogg'), 'audio');
    strictEqual(mediaCategory('font/woff2'), 'font');
    strictEqual(mediaCategory('font/ttf'), 'font');
  });

  it('maps prose text to text and edited text formats to code', () => {
    strictEqual(mediaCategory('text/plain'), 'text');
    strictEqual(mediaCategory('text/markdown'), 'text');
    strictEqual(mediaCategory('text/vtt'), 'text');
    strictEqual(mediaCategory('text/html'), 'code');
    strictEqual(mediaCategory('text/css'), 'code');
    strictEqual(mediaCategory('text/javascript'), 'code');
    strictEqual(mediaCategory('text/xml'), 'code');
    strictEqual(mediaCategory('text/csv'), 'code');
  });

  it('maps office and portable formats to document', () => {
    strictEqual(mediaCategory('application/pdf'), 'document');
    strictEqual(mediaCategory('application/msword'), 'document');
    strictEqual(mediaCategory('application/rtf'), 'document');
    strictEqual(mediaCategory('application/vnd.ms-excel'), 'document');
    strictEqual(mediaCategory('application/vnd.ms-powerpoint'), 'document');
    strictEqual(
      mediaCategory('application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
      'document',
    );
    strictEqual(
      mediaCategory('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
      'document',
    );
    strictEqual(
      mediaCategory('application/vnd.openxmlformats-officedocument.presentationml.presentation'),
      'document',
    );
    strictEqual(mediaCategory('application/vnd.oasis.opendocument.text'), 'document');
    strictEqual(mediaCategory('application/vnd.oasis.opendocument.spreadsheet'), 'document');
    strictEqual(mediaCategory('application/vnd.oasis.opendocument.presentation'), 'document');
  });

  it('maps compressed containers to archive', () => {
    strictEqual(mediaCategory('application/zip'), 'archive');
    strictEqual(mediaCategory('application/gzip'), 'archive');
    strictEqual(mediaCategory('application/x-7z-compressed'), 'archive');
    strictEqual(mediaCategory('application/x-rar-compressed'), 'archive');
    strictEqual(mediaCategory('application/vnd.rar'), 'archive');
    strictEqual(mediaCategory('application/x-tar'), 'archive');
    strictEqual(mediaCategory('application/x-bzip2'), 'archive');
    strictEqual(mediaCategory('application/x-xz'), 'archive');
  });

  it('maps data and program formats to code', () => {
    strictEqual(mediaCategory('application/json'), 'code');
    strictEqual(mediaCategory('application/ld+json'), 'code');
    strictEqual(mediaCategory('application/javascript'), 'code');
    strictEqual(mediaCategory('application/xml'), 'code');
    strictEqual(mediaCategory('application/yaml'), 'code');
    strictEqual(mediaCategory('application/x-yaml'), 'code');
    strictEqual(mediaCategory('application/wasm'), 'code');
    strictEqual(mediaCategory('application/toml'), 'code');
  });

  it('ignores parameters and case', () => {
    strictEqual(mediaCategory('text/plain; charset=utf-8'), 'text');
    strictEqual(mediaCategory('Application/PDF'), 'document');
    strictEqual(mediaCategory('IMAGE/PNG'), 'image');
  });

  it('falls back to other for anything unlisted', () => {
    strictEqual(mediaCategory('application/octet-stream'), 'other');
    strictEqual(mediaCategory('application/epub+zip'), 'other');
    strictEqual(mediaCategory('application/vnd.ms-fontobject'), 'other');
    strictEqual(mediaCategory('multipart/form-data'), 'other');
    strictEqual(mediaCategory('model/gltf+json'), 'other');
    strictEqual(mediaCategory(''), 'other');
  });

  it('never resolves an inherited table name', () => {
    strictEqual(mediaCategory('__proto__/x'), 'other');
    strictEqual(mediaCategory('constructor'), 'other');
    strictEqual(mediaCategory('application/toString'), 'other');
  });
});
