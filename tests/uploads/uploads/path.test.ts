import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { Buffer } from 'node:buffer';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { useLayers } from '../../../src/ohne/layers/use-layers.ts';
import { queryUntyped } from '../../../src/ohne/query/query.ts';
import { createFSStorage } from '../../../src/uploads/storage/fs.ts';
import { drainJournal } from '../../../src/uploads/storage/journal.ts';
import { useStorage, useStorages } from '../../../src/uploads/storage/use-storages.ts';
import {
  ancestorDirectories,
  canonicalDirectory,
  canonicalName,
  splitUploadPath,
  TEMP_PREFIX,
  uniqueUploadName,
  uploadPath,
} from '../../../src/uploads/uploads/path.ts';
import { putUpload } from '../../../src/uploads/uploads/put-upload.ts';
import { bytes, stream } from '../_fixture.ts';

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

  it('cuts a name to 255 bytes at the end of its stem, keeping the extension', () => {
    const name = canonicalName(`${'Sylvanas Windrunner '.repeat(20)}.PNG`);
    strictEqual(Buffer.byteLength(name), 255);
    ok(name.startsWith('sylvanas-windrunner-sylvanas'));
    ok(name.endsWith('.png'));
    strictEqual(canonicalName(name), name);
    strictEqual(canonicalName(`${'a'.repeat(254)}.txt`), `${'a'.repeat(251)}.txt`);
    strictEqual(canonicalName('b'.repeat(300)), 'b'.repeat(255));
  });

  it('never cuts a name into a separator its sanitizer would drop', () => {
    strictEqual(canonicalName(`${'a'.repeat(250)}-bbbbbb.txt`), `${'a'.repeat(250)}.txt`);
    strictEqual(canonicalName(`${'a'.repeat(250)}.bbbbbbbbbb.txt`), `${'a'.repeat(250)}.txt`);
  });

  it('cuts a directory segment as it cuts a name', () => {
    strictEqual(
      canonicalDirectory(`Thrall/${'Durotan '.repeat(40)}`).length,
      'thrall/'.length + 255,
    );
    strictEqual(canonicalDirectory(`${'a'.repeat(255)}-b/c`), `${'a'.repeat(255)}/c`);
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

  it('cuts the stem so a suffixed name still fits 255 bytes', () => {
    const name = `${'a'.repeat(251)}.txt`;
    const second = uniqueUploadName(name, [name]);
    strictEqual(second, `${'a'.repeat(249)}-2.txt`);
    strictEqual(uniqueUploadName(name, [name, second]), `${'a'.repeat(249)}-3.txt`);

    const ninth = `${'a'.repeat(249)}-9.txt`;
    strictEqual(uniqueUploadName(ninth, [ninth]), `${'a'.repeat(248)}-10.txt`);
    strictEqual(canonicalName(second), second);
  });

  it('keeps a suffix too long to count exactly as part of the stem', () => {
    const name = 'thrall-9007199254740992.txt';
    strictEqual(uniqueUploadName(name, [name]), 'thrall-9007199254740992-2.txt');
    strictEqual(
      uniqueUploadName('jaina-999999999999999', ['jaina-999999999999999']),
      'jaina-1000000000000000',
    );
  });
});

describe('ancestorDirectories', () => {
  it('lists every folder a directory implies, shallowest first', () => {
    deepStrictEqual(ancestorDirectories('a/b/c'), ['a', 'a/b', 'a/b/c']);
    deepStrictEqual(ancestorDirectories('a'), ['a']);
    deepStrictEqual(ancestorDirectories(''), []);
  });
});

describe('on the fs backend', () => {
  const root = mkdtempSync(join(tmpdir(), 'ohne-path-'));

  before(() => {
    useStorages().register('fs', createFSStorage);
    useLayers().add({ path: '/uploads-fs', input: { uploads: { storage: 'fs', url: root } } });
  });

  after(() => {
    useLayers().remove('/uploads-fs');
    rmSync(root, { recursive: true, force: true });
  });

  it('lands a long name and its suffixed twin where their rows say', async () => {
    const name = `${'Jaina Proudmoore '.repeat(20)}.txt`;
    const first = await putUpload({ directory: 'Theramore', name, body: stream(bytes('1')) });
    const second = await putUpload({ directory: 'Theramore', name, body: stream(bytes('22')) });
    ok(Buffer.byteLength(first.name) <= 255);
    ok(Buffer.byteLength(second.name) <= 255);
    deepStrictEqual(await useStorage().stat(first.path), { size: 1 });
    deepStrictEqual(await useStorage().stat(second.path), { size: 2 });
    strictEqual(await queryUntyped('UploadsJournal').count(), 0);
  });

  it('lands a file under a long directory segment', async () => {
    const upload = await putUpload({
      directory: `Durnholde/${'Aedelas Blackmoore '.repeat(20)}`,
      name: 'thrall.txt',
      body: stream(bytes('3')),
    });
    deepStrictEqual(await useStorage().stat(upload.path), { size: 1 });
    strictEqual(await drainJournal(), true);
    strictEqual(await queryUntyped('UploadsJournal').count(), 0);
  });
});
