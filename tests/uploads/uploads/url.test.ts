import { match, ok, strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import '../_fixture.ts';
import { useEnv } from '../../../src/ohne/env/use-env.ts';
import { useLayers } from '../../../src/ohne/layers/use-layers.ts';
import { useStorages } from '../../../src/uploads/storage/use-storages.ts';
import { signUploadLink } from '../../../src/uploads/uploads/sign.ts';
import { temporaryUploadURL, uploadURL } from '../../../src/uploads/uploads/url.ts';
import { parseDuration } from '../../../src/utils/index.ts';
import { createMemoryStorage } from '../_storage.ts';

const sunset = { directory: 'photos/2024', name: 'sunset.jpg' };
const EXPIRES = 1_700_000_000_000;
const locked = { ...sunset, private: true, expires: EXPIRES };
const signature = signUploadLink('photos/2024/sunset.jpg', EXPIRES, 'secret');

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

function withSecret<T>(run: () => T): T {
  useEnv().set('UPLOADS_SECRET', 'secret');
  try {
    return run();
  } finally {
    useEnv().unset('UPLOADS_SECRET');
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

  it('signs a private file on the API route, past publicURL and the backend', () => {
    withSecret(() => {
      strictEqual(uploadURL(locked), `/uploads/photos/2024/sunset.jpg?e=${EXPIRES}&s=${signature}`);
      withLayer({ uploads: { storage: 'served', publicURL: 'https://cdn.example.com' } }, () => {
        strictEqual(
          uploadURL(locked),
          `/uploads/photos/2024/sunset.jpg?e=${EXPIRES}&s=${signature}`,
        );
      });
      withLayer({ api: { basePath: '/api/' } }, () => {
        strictEqual(
          uploadURL(locked),
          `/api/uploads/photos/2024/sunset.jpg?e=${EXPIRES}&s=${signature}`,
        );
      });
    });
  });

  it('answers the bare API route for a private file without a secret or an expiry', () => {
    withLayer({ uploads: { storage: 'served', publicURL: 'https://cdn.example.com' } }, () => {
      strictEqual(uploadURL(locked), '/uploads/photos/2024/sunset.jpg');
      withSecret(() => {
        strictEqual(uploadURL({ ...sunset, private: true }), '/uploads/photos/2024/sunset.jpg');
      });
    });
  });

  it('treats a false or null private as public', () => {
    withSecret(() => {
      strictEqual(
        uploadURL({ ...sunset, private: false, expires: EXPIRES }),
        '/uploads/photos/2024/sunset.jpg',
      );
      strictEqual(
        uploadURL({ ...sunset, private: null, expires: EXPIRES }),
        '/uploads/photos/2024/sunset.jpg',
      );
    });
  });
});

describe('temporaryUploadURL', () => {
  it('throws without a secret', () => {
    throws(() => temporaryUploadURL(sunset, '7d'), /Set `UPLOADS_SECRET` to make temporary links/);
  });

  it('signs a link that expires maxAge from now, not aligned to a window', () => {
    withSecret(() => {
      const before = Date.now();
      const { url, expires } = temporaryUploadURL(sunset, '7d');
      const drift = expires - before - parseDuration('7d');
      ok(drift >= 0 && drift < parseDuration('1m'), `expires drifts ${drift}ms`);
      strictEqual(url, uploadURL({ ...sunset, private: true, expires }));
      match(url, /^\/uploads\/photos\/2024\/sunset\.jpg\?e=\d+&s=[A-Za-z0-9_-]{43}$/);
    });
  });

  it('rejects a maxAge that parseDuration rejects', () => {
    withSecret(() => {
      throws(() => temporaryUploadURL(sunset, 'soon'), /Invalid duration/);
    });
  });
});
