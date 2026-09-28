import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import {
  storedFileName,
  storedFolderName,
} from '../../../../src/uploads/dashboard/components/_names.ts';
import { canonicalFolderName, canonicalName } from '../../../../src/uploads/uploads/path.ts';

describe('storedFolderName', () => {
  it('slugs the name the way the server stores it', () => {
    strictEqual(storedFolderName('My Folder'), 'my-folder');
    strictEqual(storedFolderName('Fotos 2024'), 'fotos-2024');
    strictEqual(storedFolderName('photos.JPG'), 'photos-jpg');
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

describe('stored names past 255 bytes', () => {
  const stem = 'frostmourne-'.repeat(25);

  it('cuts the stem and keeps the extension, as the server stores it', () => {
    strictEqual(storedFileName('a'.repeat(300), 'png'), `${'a'.repeat(251)}.png`);
    strictEqual(storedFolderName('b'.repeat(300)), 'b'.repeat(255));
    strictEqual(storedFileName(stem, 'png'), `${stem.slice(0, 251).replace(/-+$/, '')}.png`);
  });

  it('previews exactly what `canonicalFolderName` and `canonicalName` store', () => {
    const typed = [
      'Arthas Menethil',
      stem,
      `${stem}.JPG`,
      `${'Thrall '.repeat(40)}.webp`,
      'lich.king.'.repeat(30),
      `${'a'.repeat(254)}.b!`,
      `Ünïcode ${'Sylvanas '.repeat(35)}.tar.gz`,
    ];
    for (const name of typed) strictEqual(storedFolderName(name), canonicalFolderName(name), name);
    for (const name of typed) {
      strictEqual(storedFileName(name, 'png'), canonicalName(`${name}.png`), name);
    }
  });
});
