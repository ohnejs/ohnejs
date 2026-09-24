import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { didYouMean } from '../../../src/utils/index.ts';

describe('didYouMean', () => {
  it('returns the closest candidate within distance', () => {
    strictEqual(didYouMean('Filesy', ['Files', 'Users', 'Posts']), 'Files');
  });

  it('returns undefined when no candidate is within distance', () => {
    strictEqual(didYouMean('Zzzz', ['Files', 'Users', 'Posts']), undefined);
  });

  it('returns undefined for an empty candidate list', () => {
    strictEqual(didYouMean('Files', []), undefined);
  });

  it('returns the exact match when input is a candidate', () => {
    strictEqual(didYouMean('Files', ['Files', 'Filey']), 'Files');
  });

  it('catches single-character typos', () => {
    strictEqual(didYouMean('txt', ['text', 'markdown', 'number']), 'text');
  });

  it('catches adjacent transpositions as a single edit', () => {
    strictEqual(didYouMean('Fiels', ['Files', 'Tags']), 'Files');
  });

  it('prefers a closer candidate over a farther one beyond the cutoff', () => {
    strictEqual(didYouMean('kitten', ['sitting', 'mitten']), 'mitten');
  });

  it('respects a custom max distance', () => {
    strictEqual(didYouMean('Posts', ['Roasts'], 2), 'Roasts');
    strictEqual(didYouMean('Posts', ['Roasts'], 1), undefined);
    strictEqual(didYouMean('in', ['init'], 2), 'init');
  });

  it('breaks ties by candidate iteration order', () => {
    strictEqual(didYouMean('Posts', ['Hosts', 'Costs']), 'Hosts');
  });

  it('accepts any iterable of candidates', () => {
    strictEqual(didYouMean('Filesy', new Set(['Files', 'Users'])), 'Files');
  });

  it('defaults to half the input length, at most 2', () => {
    strictEqual(didYouMean('x', ['db', 'pm']), undefined);
    strictEqual(didYouMean('dev', ['db']), undefined);
    strictEqual(didYouMean('dv', ['db']), 'db');
    strictEqual(didYouMean('', ['a', 'bb', 'ccc']), undefined);
    strictEqual(didYouMean('Postgres', ['Postfix']), undefined);
  });
});
