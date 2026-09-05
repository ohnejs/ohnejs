import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import '../_fixture.ts';
import { useLayers } from '../../../src/ohne/layers/use-layers.ts';
import { uploadURL } from '../../../src/uploads/uploads/url.ts';

const sunset = { directory: 'photos/2024', name: 'sunset.jpg' };

function withLayer<T>(input: Record<string, unknown>, run: () => T): T {
  useLayers().add({ path: '/uploads-url', input });
  try {
    return run();
  } finally {
    useLayers().remove('/uploads-url');
  }
}

describe('uploadURL', () => {
  it('points at the API route, root-relative, by default', () => {
    strictEqual(uploadURL(sunset), '/uploads/photos/2024/sunset.jpg');
    strictEqual(uploadURL({ directory: '', name: 'sunset.jpg' }), '/uploads/sunset.jpg');
  });

  it('prefixes the API base path, normalized', () => {
    withLayer({ api: { basePath: '/api/' } }, () => {
      strictEqual(uploadURL(sunset), '/api/uploads/photos/2024/sunset.jpg');
    });
  });

  it('points at uploads.publicURL when set, without a trailing slash', () => {
    withLayer({ uploads: { publicURL: 'https://cdn.example.com/' } }, () => {
      strictEqual(uploadURL(sunset), 'https://cdn.example.com/photos/2024/sunset.jpg');
    });
    withLayer({ uploads: { publicURL: 'https://cdn.example.com/media' } }, () => {
      strictEqual(uploadURL(sunset), 'https://cdn.example.com/media/photos/2024/sunset.jpg');
    });
  });
});
