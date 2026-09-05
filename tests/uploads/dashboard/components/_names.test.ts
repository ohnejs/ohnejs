import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import {
  storedFileName,
  storedFolderName,
} from '../../../../src/uploads/dashboard/components/_names.ts';

describe('storedFolderName', () => {
  it('slugs the name the way the server stores it', () => {
    strictEqual(storedFolderName('My Folder'), 'my-folder');
    strictEqual(storedFolderName('Fotos 2024'), 'fotos-2024');
    strictEqual(storedFolderName('photos.JPG'), 'photos.jpg');
    strictEqual(storedFolderName('Ünïcode'), 'unicode');
  });

  it('answers nothing when nothing in the name can slug', () => {
    strictEqual(storedFolderName(''), '');
    strictEqual(storedFolderName('   '), '');
    strictEqual(storedFolderName('!!!'), '');
  });
});

describe('storedFileName', () => {
  it('slugs the stem and keeps the extension', () => {
    strictEqual(storedFileName('My Photo', 'jpg'), 'my-photo.jpg');
    strictEqual(storedFileName('archive.tar', 'gz'), 'archive.tar.gz');
    strictEqual(storedFileName('Ünïcode', 'png'), 'unicode.png');
    strictEqual(storedFileName('a..b', 'txt'), 'a.b.txt');
  });

  it('handles a file without an extension', () => {
    strictEqual(storedFileName('notes', ''), 'notes');
    strictEqual(storedFileName('Read Me', ''), 'read-me');
  });

  it('answers nothing when nothing in the stem can slug', () => {
    strictEqual(storedFileName('', 'jpg'), '');
    strictEqual(storedFileName('...', 'jpg'), '');
    strictEqual(storedFileName('!!!', ''), '');
  });
});
