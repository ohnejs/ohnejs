import { deepStrictEqual, match, ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import '../_fixture.ts';
import { useEnv } from '../../../src/ohne/env/use-env.ts';
import { useLayers } from '../../../src/ohne/layers/use-layers.ts';
import { decorateUpload, decorateUploads } from '../../../src/uploads/uploads/decorate.ts';
import { signUploadLink } from '../../../src/uploads/uploads/sign.ts';
import { alignExpiry, parseDuration } from '../../../src/utils/index.ts';

const SERVICE = 'https://img.example.com';

function locked(name: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { directory: 'locked', name, type: 'image/png', private: true, ...extra };
}

describe('decorateUpload', () => {
  it('adds path and url from directory and name', () => {
    const record: Record<string, unknown> = { directory: 'photos', name: 'sunset.jpg', size: 1 };
    decorateUpload(record);
    deepStrictEqual(record, {
      directory: 'photos',
      name: 'sunset.jpg',
      size: 1,
      path: 'photos/sunset.jpg',
      url: '/uploads/photos/sunset.jpg',
    });
  });

  it('leaves a record without both parts untouched', () => {
    const noName: Record<string, unknown> = { directory: 'photos' };
    const noDirectory: Record<string, unknown> = { name: 'sunset.jpg' };
    decorateUpload(noName);
    decorateUpload(noDirectory);
    deepStrictEqual(noName, { directory: 'photos' });
    deepStrictEqual(noDirectory, { name: 'sunset.jpg' });
  });

  it('never sets variants without a service', () => {
    const record: Record<string, unknown> = { directory: '', name: 'a.png', type: 'image/png' };
    decorateUpload(record);
    deepStrictEqual(Object.keys(record).sort(), ['directory', 'name', 'path', 'type', 'url']);
  });

  it('decorates a public record the same with a secret set', () => {
    useEnv().set('UPLOADS_SECRET', 'secret');
    try {
      const record = locked('open.png', { private: false });
      decorateUpload(record);
      deepStrictEqual(Object.keys(record).sort(), [
        'directory',
        'name',
        'path',
        'private',
        'type',
        'url',
      ]);
      strictEqual(record.url, '/uploads/locked/open.png');
    } finally {
      useEnv().unset('UPLOADS_SECRET');
    }
  });

  it('signs a private file until the end of the window after the current one', () => {
    useEnv().set('UPLOADS_SECRET', 'secret');
    try {
      const record = locked('a.png');
      const before = Date.now();
      decorateUpload(record);
      const expires = record.expires as number;
      const window = parseDuration('1h');
      ok([alignExpiry(before, window), alignExpiry(Date.now(), window)].includes(expires));
      strictEqual(
        record.url,
        `/uploads/locked/a.png?e=${expires}&s=${signUploadLink('locked/a.png', expires, 'secret')}`,
      );
      strictEqual(record.variants, undefined);
    } finally {
      useEnv().unset('UPLOADS_SECRET');
    }
  });

  it('aligns expires to uploads.privateMaxAge', () => {
    useEnv().set('UPLOADS_SECRET', 'secret');
    useLayers().add({ path: '/decorate-window', input: { uploads: { privateMaxAge: '10m' } } });
    try {
      const record = locked('b.png');
      decorateUpload(record);
      const expires = record.expires as number;
      const window = parseDuration('10m');
      strictEqual(expires % window, 0);
      const remaining = expires - Date.now();
      ok(remaining > 0 && remaining <= 2 * window, `expires in ${remaining}ms`);
    } finally {
      useLayers().remove('/decorate-window');
      useEnv().unset('UPLOADS_SECRET');
    }
  });

  it('keeps a private file on the bare API route without UPLOADS_SECRET', () => {
    useLayers().add({
      path: '/decorate-public',
      input: { uploads: { images: { url: SERVICE }, publicURL: 'https://cdn.example.com' } },
    });
    useEnv().set('IMAGES_SECRET', 'secret');
    try {
      const record = locked('c.png');
      decorateUpload(record);
      strictEqual(record.url, '/uploads/locked/c.png');
      strictEqual(record.expires, undefined);
      strictEqual(record.variants, undefined);
      const open = locked('d.png', { private: false });
      decorateUpload(open);
      strictEqual(open.url, 'https://cdn.example.com/locked/d.png');
      match((open.variants as Record<string, string>).thumbnail, /^https:\/\/img\.example\.com\//);
    } finally {
      useEnv().unset('IMAGES_SECRET');
      useLayers().remove('/decorate-public');
    }
  });

  it('gives a private file variants only when the image service can sign them', () => {
    useLayers().add({ path: '/decorate-images', input: { uploads: { images: { url: SERVICE } } } });
    useEnv().set('UPLOADS_SECRET', 'secret');
    try {
      const unsigned = locked('e.png');
      decorateUpload(unsigned);
      strictEqual(unsigned.variants, undefined);
      useEnv().set('IMAGES_SECRET', 'secret');
      const signed = locked('f.png');
      decorateUpload(signed);
      const { thumbnail } = signed.variants as Record<string, string>;
      match(
        thumbnail,
        new RegExp(
          `^https://img\\.example\\.com/[A-Za-z0-9_-]{43}/w_320,h_320,fit_inside,f_webp,e_${signed.expires}/locked/f\\.png$`,
        ),
      );
    } finally {
      useEnv().unset('IMAGES_SECRET');
      useEnv().unset('UPLOADS_SECRET');
      useLayers().remove('/decorate-images');
    }
  });

  it('decorates a row from before private uploads, holding null, as public', () => {
    useLayers().add({
      path: '/decorate-legacy',
      input: { uploads: { publicURL: 'https://cdn.example.com' } },
    });
    useEnv().set('UPLOADS_SECRET', 'secret');
    try {
      const record: Record<string, unknown> = { directory: 'old', name: 'a.txt', private: null };
      decorateUpload(record);
      strictEqual(record.url, 'https://cdn.example.com/old/a.txt');
      strictEqual(record.expires, undefined);
    } finally {
      useEnv().unset('UPLOADS_SECRET');
      useLayers().remove('/decorate-legacy');
    }
  });

  it('decorates a file read without private as a private one', () => {
    useLayers().add({
      path: '/decorate-unknown',
      input: { uploads: { images: { url: SERVICE }, publicURL: 'https://cdn.example.com' } },
    });
    useEnv().set('UPLOADS_SECRET', 'secret');
    useEnv().set('IMAGES_SECRET', 'secret');
    try {
      const record: Record<string, unknown> = {
        directory: 'zzc',
        name: 'pic.png',
        type: 'image/png',
      };
      decorateUpload(record);
      const expires = record.expires as number;
      ok(expires > Date.now());
      strictEqual(
        record.url,
        `/uploads/zzc/pic.png?e=${expires}&s=${signUploadLink('zzc/pic.png', expires, 'secret')}`,
      );
      match(
        (record.variants as Record<string, string>).thumbnail,
        new RegExp(`/w_320,h_320,fit_inside,f_webp,e_${expires}/zzc/pic\\.png$`),
      );
    } finally {
      useEnv().unset('IMAGES_SECRET');
      useEnv().unset('UPLOADS_SECRET');
      useLayers().remove('/decorate-unknown');
    }
  });

  it('gives a private folder its path alone', () => {
    useEnv().set('UPLOADS_SECRET', 'secret');
    try {
      const folder: Record<string, unknown> = {
        kind: 'folder',
        directory: '',
        name: 'locked',
        private: true,
      };
      decorateUpload(folder);
      deepStrictEqual(Object.keys(folder).sort(), ['directory', 'kind', 'name', 'path', 'private']);
    } finally {
      useEnv().unset('UPLOADS_SECRET');
    }
  });
});

describe('decorateUploads', () => {
  it('decorates every record of a read', () => {
    const records: Record<string, unknown>[] = [
      { directory: '', name: 'a.txt' },
      { directory: 'b', name: 'c.txt' },
      { name: 'orphan' },
    ];
    decorateUploads(records);
    deepStrictEqual(
      records.map((record) => record.path),
      ['a.txt', 'b/c.txt', undefined],
    );
  });
});
