import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { suggest } from '../../../src/utils/index.ts';

describe('suggest', () => {
  it('returns the closest candidate within distance', () => {
    strictEqual(suggest('Filesy', ['Files', 'Users', 'Posts']), 'Files');
  });

  it('returns undefined when no candidate is within distance', () => {
    strictEqual(suggest('Zzzz', ['Files', 'Users', 'Posts']), undefined);
  });

  it('returns undefined for an empty candidate list', () => {
    strictEqual(suggest('Files', []), undefined);
  });

  it('returns the exact match when input is a candidate', () => {
    strictEqual(suggest('Files', ['Files', 'Filey']), 'Files');
  });

  it('catches single-character typos', () => {
    strictEqual(suggest('txt', ['text', 'markdown', 'number']), 'text');
  });

  it('catches adjacent transpositions as a single edit', () => {
    strictEqual(suggest('Fiels', ['Files', 'Tags']), 'Files');
  });

  it('prefers a closer candidate over a farther one beyond the cutoff', () => {
    strictEqual(suggest('kitten', ['sitting', 'mitten']), 'mitten');
  });

  it('respects a custom max distance', () => {
    strictEqual(suggest('Posts', ['Roasts'], 2), 'Roasts');
    strictEqual(suggest('Posts', ['Roasts'], 1), undefined);
  });

  it('breaks ties by candidate iteration order', () => {
    strictEqual(suggest('Posts', ['Hosts', 'Costs']), 'Hosts');
  });

  it('accepts any iterable of candidates', () => {
    strictEqual(suggest('Filesy', new Set(['Files', 'Users'])), 'Files');
  });

  it('handles empty input', () => {
    strictEqual(suggest('', ['a', 'bb', 'ccc']), 'a');
  });
});
