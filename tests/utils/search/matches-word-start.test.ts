import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { matchesWordStart } from '../../../src/utils/index.ts';

describe('matchesWordStart', () => {
  it('matches a prefix of the first word', () => {
    strictEqual(matchesWordStart('Published', 'pub'), true);
  });

  it('matches a prefix of a later word', () => {
    strictEqual(matchesWordStart('In progress', 'prog'), true);
    strictEqual(matchesWordStart('on-hold', 'hold'), true);
  });

  it('refuses a match inside a word', () => {
    strictEqual(matchesWordStart('Published', 'lish'), false);
  });

  it('folds case on both sides', () => {
    strictEqual(matchesWordStart('ÉMILE', 'émi'), true);
    strictEqual(matchesWordStart('émile', 'ÉMI'), true);
  });

  it('compares canonical forms', () => {
    strictEqual(matchesWordStart('Café', 'café'), true);
  });

  it('ignores accents', () => {
    strictEqual(matchesWordStart('Café noir', 'cafe'), true);
    strictEqual(matchesWordStart('Straße', 'strasse'), true);
  });

  it('matches a phrase across words', () => {
    strictEqual(matchesWordStart('Work in progress', 'in prog'), true);
  });

  it('takes the prefix literally, never as a pattern', () => {
    strictEqual(matchesWordStart('a.b', 'a.'), true);
    strictEqual(matchesWordStart('axb', 'a.'), false);
  });

  it('refuses a match after a combining mark, which belongs to the word', () => {
    strictEqual(matchesWordStart('\u0915\u093f\u0924\u093e', '\u0924\u093e'), false);
  });
});
