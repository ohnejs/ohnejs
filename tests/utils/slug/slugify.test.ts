import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { slugBosnian, slugGerman, slugify } from '../../../src/utils/index.ts';

describe('slugify', () => {
  describe('default behaviour', () => {
    it('lowercases and joins words with a dash by default', () => {
      strictEqual(slugify('Hello World'), 'hello-world');
    });

    it('uses the configured separator', () => {
      strictEqual(slugify('Hello World', { separator: '_' }), 'hello_world');
    });

    it('joins with no separator when given an empty string', () => {
      strictEqual(slugify('Hello World', { separator: '' }), 'helloworld');
      strictEqual(slugify('  hello   world!!  ', { separator: '' }), 'helloworld');
    });

    it('strips leading and trailing separators', () => {
      strictEqual(slugify('  --hello--  '), 'hello');
    });

    it('collapses runs of non-alphanumeric characters', () => {
      strictEqual(slugify('  hello   world!!  '), 'hello-world');
    });

    it('preserves digits', () => {
      strictEqual(slugify('article 42'), 'article-42');
    });

    it('returns an empty string for input with no alphanumerics', () => {
      strictEqual(slugify('!!!'), '');
      strictEqual(slugify('   '), '');
      strictEqual(slugify(''), '');
    });

    it('handles regex-meta separators safely', () => {
      strictEqual(slugify('Hello World', { separator: '.' }), 'hello.world');
      strictEqual(slugify('  Hello   World  ', { separator: '.' }), 'hello.world');
    });
  });

  describe('diacritic stripping', () => {
    it('strips Latin diacritics via NFD', () => {
      strictEqual(slugify('Café au lait'), 'cafe-au-lait');
      strictEqual(slugify('naïve'), 'naive');
      strictEqual(slugify('Crème brûlée'), 'creme-brulee');
    });

    it('drops non-Latin scripts when no replacer is supplied', () => {
      strictEqual(slugify('Привет мир'), '');
      strictEqual(slugify('日本語'), '');
    });
  });

  describe('slugGerman', () => {
    it('maps umlauts to digraphs', () => {
      strictEqual(slugify('Übersetzung', { replace: slugGerman }), 'uebersetzung');
      strictEqual(slugify('Ärger mit Größe', { replace: slugGerman }), 'aerger-mit-groesse');
    });

    it('maps ß to ss', () => {
      strictEqual(slugify('Straße', { replace: slugGerman }), 'strasse');
    });

    it('lowercases ẞ and SS before mapping', () => {
      strictEqual(slugify('STRAẞE', { replace: slugGerman }), 'strasse');
      strictEqual(slugify('STRASSE', { replace: slugGerman }), 'strasse');
    });
  });

  describe('slugBosnian', () => {
    it('maps the five diacritic letters to ASCII', () => {
      strictEqual(slugify('Šuma', { replace: slugBosnian }), 'suma');
      strictEqual(slugify('Čaša', { replace: slugBosnian }), 'casa');
      strictEqual(slugify('Ćup', { replace: slugBosnian }), 'cup');
      strictEqual(slugify('Žaba', { replace: slugBosnian }), 'zaba');
      strictEqual(slugify('Đak', { replace: slugBosnian }), 'dak');
    });

    it('handles đ, which does not decompose, with or without the map', () => {
      strictEqual(slugify('Đak'), 'dak');
      strictEqual(slugify('Đak', { replace: slugBosnian }), 'dak');
    });

    it('preserves the digraphs dž, lj, nj as their plain letters', () => {
      strictEqual(slugify('Džak', { replace: slugBosnian }), 'dzak');
      strictEqual(slugify('Ljiljan', { replace: slugBosnian }), 'ljiljan');
      strictEqual(slugify('Njiva', { replace: slugBosnian }), 'njiva');
    });

    it('slugs a sentence', () => {
      strictEqual(
        slugify('Bosna i Hercegovina, Češljanje', { replace: slugBosnian }),
        'bosna-i-hercegovina-cesljanje',
      );
    });
  });

  describe('replace - multiple maps', () => {
    it('applies maps in order', () => {
      strictEqual(slugify('Größe i Đak', { replace: [slugGerman, slugBosnian] }), 'groesse-i-dak');
    });

    it('later maps see earlier maps output', () => {
      strictEqual(slugify('aaa', { replace: [{ a: 'b' }, { b: 'c' }] }), 'ccc');
    });
  });
});

describe('slugify letters without a separable accent', () => {
  it('spells them plainly, as search folds them', () => {
    strictEqual(slugify('Søren Łódź Straße ﬁle'), 'soren-lodz-strasse-file');
  });
});
