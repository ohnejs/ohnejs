import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { UploadRecord } from '../../../../src/uploads/uploads/types.ts';

import {
  detailsPatch,
  detailsStateOf,
  focalPercent,
  focalPointAt,
  isSmallPreview,
  previewKindOf,
  variantTokens,
  versionedURL,
} from '../../../../src/uploads/dashboard/components/media-details-state.ts';

function upload(
  name: string,
  type: string | null,
  extra: Partial<UploadRecord> = {},
): UploadRecord {
  return {
    UUID: name,
    kind: 'file',
    directory: '',
    name,
    type,
    size: 1,
    hash: null,
    width: null,
    height: null,
    description: null,
    focalX: null,
    focalY: null,
    author: null,
    uploadedAt: 0,
    _updatedAt: 0,
    path: name,
    url: `/uploads/${name}`,
    ...extra,
  };
}

describe('previewKindOf', () => {
  it('previews displayable images and playable videos only', () => {
    strictEqual(previewKindOf(upload('a.png', 'image/png')), 'image');
    strictEqual(previewKindOf(upload('a.mp4', 'video/mp4')), 'video');
    strictEqual(previewKindOf(upload('a.webm', 'video/webm')), 'video');
    strictEqual(previewKindOf(upload('a.pdf', 'application/pdf')), null);
    strictEqual(previewKindOf(upload('a.psd', 'image/vnd.adobe.photoshop')), null);
    strictEqual(previewKindOf(upload('a', null, { kind: 'folder' })), null);
  });
});

describe('isSmallPreview', () => {
  it('centers an image at most 480 pixels on both sides', () => {
    strictEqual(isSmallPreview(upload('a.png', 'image/png', { width: 320, height: 240 })), true);
    strictEqual(isSmallPreview(upload('a.png', 'image/png', { width: 480, height: 480 })), true);
    strictEqual(isSmallPreview(upload('a.png', 'image/png', { width: 481, height: 240 })), false);
    strictEqual(isSmallPreview(upload('a.png', 'image/png', { width: 240, height: 1200 })), false);
  });

  it('never centers an unsized image', () => {
    strictEqual(isSmallPreview(upload('a.svg', 'image/svg+xml')), false);
  });
});

describe('detailsStateOf', () => {
  it('picks the editable fields', () => {
    const record = upload('a.png', 'image/png', {
      description: 'Sunset',
      focalX: 0.5,
      focalY: 0.25,
    });
    deepStrictEqual(detailsStateOf(record), { description: 'Sunset', focalX: 0.5, focalY: 0.25 });
  });
});

describe('focalPointAt', () => {
  it('reads the click as fractions of the surface', () => {
    deepStrictEqual(focalPointAt(25, 50, 100, 200), { focalX: 0.25, focalY: 0.25 });
    deepStrictEqual(focalPointAt(100, 200, 100, 200), { focalX: 1, focalY: 1 });
  });

  it('clamps outside clicks and rounds to three decimals', () => {
    deepStrictEqual(focalPointAt(-5, 300, 100, 200), { focalX: 0, focalY: 1 });
    deepStrictEqual(focalPointAt(1, 2, 3, 3), { focalX: 0.333, focalY: 0.667 });
  });

  it('answers the origin for a surface without extent', () => {
    deepStrictEqual(focalPointAt(10, 10, 0, 0), { focalX: 0, focalY: 0 });
  });
});

describe('focalPercent', () => {
  it('formats a fraction as a percentage to one decimal', () => {
    strictEqual(focalPercent(0.333), '33.3%');
    strictEqual(focalPercent(0.5), '50%');
    strictEqual(focalPercent(1), '100%');
    strictEqual(focalPercent(0), '0%');
  });
});

describe('detailsPatch', () => {
  it('sends the focal point for an image only', () => {
    const state = { description: 'Sunset', focalX: 0.5, focalY: 0.5 };
    deepStrictEqual(detailsPatch(state, true), state);
    deepStrictEqual(detailsPatch(state, false), { description: 'Sunset' });
  });
});

describe('versionedURL', () => {
  it('appends the version as a query parameter', () => {
    strictEqual(versionedURL('/uploads/a.jpg', 7), '/uploads/a.jpg?v=7');
    strictEqual(versionedURL('/uploads/a.jpg?w=100', 7), '/uploads/a.jpg?w=100&v=7');
  });
});

describe('variantTokens', () => {
  it('reads the segment right before the path', () => {
    strictEqual(
      variantTokens(
        'https://img.test/sig/w_320,h_320,fit_inside,f_webp/photos/a.jpg',
        'photos/a.jpg',
      ),
      'w_320,h_320,fit_inside,f_webp',
    );
    strictEqual(variantTokens('https://img.test/sig/w_320/a.jpg', 'a.jpg'), 'w_320');
  });

  it('answers nothing when the URL does not end with the path', () => {
    strictEqual(variantTokens('https://img.test/sig/w_320/other.jpg', 'photos/a.jpg'), '');
    strictEqual(variantTokens('https://img.test/sig/w_320/xphotos/a.jpg', 'photos/a.jpg'), '');
  });
});
