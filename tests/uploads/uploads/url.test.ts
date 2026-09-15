import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import '../_fixture.ts';
import { useLayers } from '../../../src/ohne/layers/use-layers.ts';
import { useStorages } from '../../../src/uploads/storage/use-storages.ts';
import { uploadURL } from '../../../src/uploads/uploads/url.ts';
import { createMemoryStorage } from '../_storage.ts';

const sunset = { directory: 'photos/2024', name: 'sunset.jpg' };

useStorages().register('served', () => ({
  ...createMemoryStorage(),
  url: (path) => `https://bucket.example.com/${path}`,
}));

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

  it('points at the backend when it serves its files itself', () => {
    withLayer({ uploads: { storage: 'served' } }, () => {
      strictEqual(uploadURL(sunset), 'https://bucket.example.com/photos/2024/sunset.jpg');
    });
  });

  it('prefers uploads.publicURL over the backend', () => {
    withLayer({ uploads: { storage: 'served', publicURL: 'https://cdn.example.com' } }, () => {
      strictEqual(uploadURL(sunset), 'https://cdn.example.com/photos/2024/sunset.jpg');
    });
  });
});
