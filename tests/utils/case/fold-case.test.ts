import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { foldCase } from '../../../src/utils/case/fold-case.ts';

const matches = (text: string, needle: string): boolean =>
  foldCase(text).includes(foldCase(needle));

describe('foldCase', () => {
  it('lowercases every script', () => {
    strictEqual(foldCase('ПРИВЕТ'), 'привет');
    strictEqual(foldCase('HELLO'), 'hello');
  });

  it('reads a final sigma as a medial one', () => {
    strictEqual(foldCase('ΣΟΦΙΑΣ'), 'σοφιασ');
    strictEqual(foldCase('σοφιας'), 'σοφιασ');
  });

  it('drops accents', () => {
    strictEqual(foldCase('Émile'), 'emile');
    strictEqual(foldCase('Ἀθῆναι'), 'αθηναι');
    strictEqual(foldCase('Café'), 'cafe');
  });

  it('maps the letters that carry no separable accent', () => {
    strictEqual(
      foldCase('Straße Søren Æble Œuvre Đà Łódź Diyarbakır Ðóra Þór'),
      'strasse soren aeble oeuvre da lodz diyarbakir dora thor',
    );
  });

  it('folds compatibility forms', () => {
    strictEqual(foldCase('Ｆｕｌｌ ﬁnal'), 'full final');
    strictEqual(foldCase('100％'), '100%');
  });

  it('matches across case and accents both ways', () => {
    for (const [text, needle] of [
      ['Café', 'cafe'],
      ['cafe', 'Café'],
      ['MÜLLER', 'muller'],
      ['Straße', 'strasse'],
      ['STRASSE', 'straße'],
      ['İstanbul', 'istanbul'],
      ['Diyarbakır', 'diyarbakir'],
      ['Søren', 'soren'],
      ['Đường', 'duong'],
      ['Łódź', 'lodz'],
      ['ΣΟΦΊΑΣ', 'σοφιασ'],
      ['Ｆｕｌｌ', 'full'],
    ]) {
      strictEqual(matches(text, needle), true, `${text} / ${needle}`);
    }
  });

  it('keeps the marks that change a letter outside the Latin accents', () => {
    for (const [text, needle] of [
      ['が', 'か'],
      ['パ', 'ハ'],
      ['한글', '하'],
      ['किताब', 'कत'],
    ]) {
      strictEqual(matches(text, needle), false, `${text} / ${needle}`);
    }
  });

  it('keeps a transliterated umlaut apart', () => {
    strictEqual(matches('Müller', 'mueller'), false);
  });

  it('keeps й, ї and ў apart from и, і and у, and reads ё as е', () => {
    strictEqual(foldCase('Йод Їжак Ўзбек'), 'йод їжак ўзбек');
    strictEqual(foldCase('Ёлка'), 'елка');
  });

  it('folds й, ї and ў the same in NFD as in NFC', () => {
    strictEqual(foldCase('Йод Їжак Ўзбек'.normalize('NFD')), 'йод їжак ўзбек');
    strictEqual(foldCase('Ёлка'.normalize('NFD')), 'елка');
  });
});
