import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { mediaTypesCompatible } from '../../../src/utils/mime/media-types-compatible.ts';

describe('mediaTypesCompatible', () => {
  it('accepts an identical type', () => {
    strictEqual(mediaTypesCompatible('image/png', 'image/png'), true);
  });

  it('ignores parameters and case', () => {
    strictEqual(mediaTypesCompatible('text/html; charset=utf-8', 'text/HTML'), true);
    strictEqual(mediaTypesCompatible('Image/SVG+XML; charset=utf-8', 'image/svg+xml'), true);
  });

  it('accepts an animated PNG against a sniffed PNG', () => {
    strictEqual(mediaTypesCompatible('image/apng', 'image/png'), true);
  });

  it('accepts JPEG aliases', () => {
    strictEqual(mediaTypesCompatible('image/jpeg', 'image/pjpeg'), true);
  });

  it('accepts the HEIF family as one', () => {
    strictEqual(mediaTypesCompatible('image/heic', 'image/heif'), true);
    strictEqual(mediaTypesCompatible('image/heif', 'image/avif'), true);
    strictEqual(mediaTypesCompatible('image/avif', 'image/heic'), true);
  });

  it('accepts the ISO base media family as one', () => {
    strictEqual(mediaTypesCompatible('video/mp4', 'video/x-m4v'), true);
    strictEqual(mediaTypesCompatible('video/mp4', 'video/quicktime'), true);
    strictEqual(mediaTypesCompatible('audio/mp4', 'video/mp4'), true);
  });

  it('accepts audio and video flavours of one container', () => {
    strictEqual(mediaTypesCompatible('audio/webm', 'video/webm'), true);
    strictEqual(mediaTypesCompatible('audio/ogg', 'application/ogg'), true);
    strictEqual(mediaTypesCompatible('video/ogg', 'application/ogg'), true);
    strictEqual(mediaTypesCompatible('audio/opus', 'application/ogg'), true);
  });

  it('accepts MPEG audio aliases', () => {
    strictEqual(mediaTypesCompatible('audio/mpeg', 'audio/mp3'), true);
  });

  it('accepts every zip container against a sniffed zip', () => {
    for (const type of [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.oasis.opendocument.text',
      'application/vnd.oasis.opendocument.spreadsheet',
      'application/vnd.oasis.opendocument.presentation',
      'application/java-archive',
      'application/epub+zip',
    ]) {
      strictEqual(mediaTypesCompatible(type, 'application/zip'), true);
    }
  });

  it('accepts tar and font aliases', () => {
    strictEqual(mediaTypesCompatible('application/x-tar', 'application/tar'), true);
    strictEqual(mediaTypesCompatible('font/ttf', 'application/x-font-ttf'), true);
    strictEqual(mediaTypesCompatible('font/ttf', 'font/sfnt'), true);
    strictEqual(mediaTypesCompatible('font/otf', 'application/x-font-otf'), true);
  });

  it('is symmetric', () => {
    strictEqual(mediaTypesCompatible('application/zip', 'application/epub+zip'), true);
    strictEqual(mediaTypesCompatible('application/epub+zip', 'application/zip'), true);
    strictEqual(mediaTypesCompatible('video/quicktime', 'video/mp4'), true);
    strictEqual(mediaTypesCompatible('video/mp4', 'video/quicktime'), true);
  });

  it('rejects types from different groups', () => {
    strictEqual(mediaTypesCompatible('image/png', 'text/html'), false);
    strictEqual(mediaTypesCompatible('image/jpeg', 'image/heic'), false);
    strictEqual(mediaTypesCompatible('font/ttf', 'font/otf'), false);
    strictEqual(mediaTypesCompatible('application/zip', 'application/gzip'), false);
    strictEqual(mediaTypesCompatible('video/mp4', 'video/webm'), false);
  });

  it('rejects a type with no group against anything else', () => {
    strictEqual(mediaTypesCompatible('image/png', 'image/gif'), false);
    strictEqual(mediaTypesCompatible('application/pdf', 'application/zip'), false);
    strictEqual(mediaTypesCompatible('', 'image/png'), false);
  });
});
