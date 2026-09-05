import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import {
  ancestorDirectories,
  canonicalDirectory,
  canonicalName,
  splitUploadPath,
  TEMP_PREFIX,
  uniqueUploadName,
  uploadPath,
} from '../../../src/uploads/uploads/path.ts';

describe('canonical forms', () => {
  it('slugs every directory segment and drops empty ones', () => {
    strictEqual(canonicalDirectory('Photos//2024 Summer/'), 'photos/2024-summer');
    strictEqual(canonicalDirectory('/'), '');
    strictEqual(canonicalDirectory(''), '');
  });

  it('slugs a name and keeps its extension lowercased', () => {
    strictEqual(canonicalName('Sunset At Sea.JPG'), 'sunset-at-sea.jpg');
    strictEqual(canonicalName('Reports 2024'), 'reports-2024');
  });
});

describe('uploadPath', () => {
  it('joins a location, at the root and below', () => {
    strictEqual(
      uploadPath({ directory: 'photos/2024', name: 'sunset.jpg' }),
      'photos/2024/sunset.jpg',
    );
    strictEqual(uploadPath({ directory: '', name: 'sunset.jpg' }), 'sunset.jpg');
  });

  it('keeps the temp prefix out of any slug', () => {
    strictEqual(TEMP_PREFIX, '.tmp');
    strictEqual(canonicalDirectory(TEMP_PREFIX) === TEMP_PREFIX, false);
  });
});

describe('splitUploadPath', () => {
  it('splits at the last slash, the root directory being empty', () => {
    deepStrictEqual(splitUploadPath('photos/2024/sunset.jpg'), {
      directory: 'photos/2024',
      name: 'sunset.jpg',
    });
    deepStrictEqual(splitUploadPath('sunset.jpg'), { directory: '', name: 'sunset.jpg' });
  });

  it('round-trips uploadPath', () => {
    for (const path of ['a', 'a/b', 'a/b/c.txt']) {
      strictEqual(uploadPath(splitUploadPath(path)), path);
    }
  });
});

describe('uniqueUploadName', () => {
  it('suffixes the stem and keeps the extension', () => {
    strictEqual(uniqueUploadName('sunset.jpg', []), 'sunset.jpg');
    strictEqual(uniqueUploadName('sunset.jpg', ['sunset.jpg']), 'sunset-2.jpg');
    strictEqual(uniqueUploadName('sunset.jpg', ['sunset.jpg', 'sunset-2.jpg']), 'sunset-3.jpg');
    strictEqual(uniqueUploadName('sunset-2.jpg', ['sunset-2.jpg']), 'sunset-3.jpg');
  });

  it('counts only siblings with the same extension', () => {
    strictEqual(uniqueUploadName('sunset.jpg', ['sunset.png', 'sunset']), 'sunset.jpg');
    strictEqual(uniqueUploadName('notes', ['notes', 'notes.txt']), 'notes-2');
  });

  it('splits an extension only where slugifyFileName would', () => {
    strictEqual(uniqueUploadName('archive.tar.gz', ['archive.tar.gz']), 'archive.tar-2.gz');
    strictEqual(uniqueUploadName('a.b-c', ['a.b-c']), 'a.b-c-2');
  });
});

describe('ancestorDirectories', () => {
  it('lists every folder a directory implies, shallowest first', () => {
    deepStrictEqual(ancestorDirectories('a/b/c'), ['a', 'a/b', 'a/b/c']);
    deepStrictEqual(ancestorDirectories('a'), ['a']);
    deepStrictEqual(ancestorDirectories(''), []);
  });
});
