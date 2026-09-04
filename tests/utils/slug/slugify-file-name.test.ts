import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { slugifyFileName } from '../../../src/utils/slug/slugify-file-name.ts';
import { slugGerman } from '../../../src/utils/slug/slugify.ts';

describe('slugifyFileName', () => {
  it('slugifies the stem and lowercases the extension', () => {
    strictEqual(slugifyFileName('Sunset At Beach.JPG'), 'sunset-at-beach.jpg');
  });

  it('trims the name', () => {
    strictEqual(slugifyFileName('  photo.PNG  '), 'photo.png');
  });

  it('keeps inner dots of the stem', () => {
    strictEqual(slugifyFileName('my.photo.v2.jpeg'), 'my.photo.v2.jpeg');
    strictEqual(slugifyFileName('archive.tar.gz'), 'archive.tar.gz');
  });

  it('treats a dotfile as a stem without extension', () => {
    strictEqual(slugifyFileName('.env'), 'env');
    strictEqual(slugifyFileName('.JPG'), 'jpg');
  });

  it('leaves no slash or dot segment behind', () => {
    strictEqual(slugifyFileName('../etc/passwd'), 'etc-passwd');
    strictEqual(slugifyFileName('..\\windows\\system32'), 'windows-system32');
    strictEqual(slugifyFileName('...jpg'), 'file.jpg');
  });

  it('falls back to file for an empty stem', () => {
    strictEqual(slugifyFileName(''), 'file');
    strictEqual(slugifyFileName('   '), 'file');
    strictEqual(slugifyFileName('!!!.png'), 'file.png');
  });

  it('drops a trailing dot', () => {
    strictEqual(slugifyFileName('notes.'), 'notes');
  });

  it('treats a suffix with other characters as part of the stem', () => {
    strictEqual(slugifyFileName('notes.md!'), 'notes.md');
    strictEqual(slugifyFileName('a.b c'), 'a.b-c');
  });

  it('limits the extension to eight characters', () => {
    strictEqual(slugifyFileName('!!!.abcdefgh'), 'file.abcdefgh');
    strictEqual(slugifyFileName('!!!.abcdefghi'), 'abcdefghi');
  });

  it('passes options through to slugify', () => {
    strictEqual(slugifyFileName('Übersicht.pdf'), 'ubersicht.pdf');
    strictEqual(slugifyFileName('Übersicht.pdf', { replace: slugGerman }), 'uebersicht.pdf');
    strictEqual(slugifyFileName('Sunset At Beach.JPG', { separator: '_' }), 'sunset_at_beach.jpg');
  });
});
