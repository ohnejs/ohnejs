import { strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { uniqueName } from '../../../src/utils/index.ts';

describe('uniqueName', () => {
  describe('with a Set', () => {
    it('returns base when not taken', () => {
      strictEqual(uniqueName('foo', new Set()), 'foo');
      strictEqual(uniqueName('foo', new Set(['bar'])), 'foo');
    });

    it('appends -2 on first collision', () => {
      strictEqual(uniqueName('foo', new Set(['foo'])), 'foo-2');
    });

    it('counts up through collisions', () => {
      strictEqual(uniqueName('foo', new Set(['foo', 'foo-2'])), 'foo-3');
      strictEqual(uniqueName('foo', new Set(['foo', 'foo-2', 'foo-3'])), 'foo-4');
    });

    it('peels an existing -N suffix and increments', () => {
      strictEqual(uniqueName('foo-2', new Set(['foo-2'])), 'foo-3');
      strictEqual(uniqueName('foo-5', new Set(['foo-5'])), 'foo-6');
    });

    it('skips gaps when later suffixes are also taken', () => {
      strictEqual(uniqueName('foo', new Set(['foo', 'foo-2', 'foo-4'])), 'foo-3');
    });

    it('does not mutate the taken set', () => {
      const taken = new Set(['foo']);
      uniqueName('foo', taken);
      strictEqual(taken.size, 1);
      strictEqual(taken.has('foo'), true);
    });
  });

  describe('with an array', () => {
    it('returns base when not taken', () => {
      strictEqual(uniqueName('foo', []), 'foo');
    });

    it('counts up through collisions', () => {
      strictEqual(uniqueName('foo', ['foo', 'foo-2', 'foo-3']), 'foo-4');
    });

    it('does not mutate the taken array', () => {
      const taken = ['foo'];
      uniqueName('foo', taken);
      strictEqual(taken.length, 1);
    });
  });

  describe('suffix peeling', () => {
    it('treats the rightmost -N as the suffix', () => {
      strictEqual(uniqueName('foo-2-3', new Set(['foo-2-3'])), 'foo-2-4');
    });

    it('does not peel non-numeric trailing segments', () => {
      strictEqual(uniqueName('foo-bar', new Set(['foo-bar'])), 'foo-bar-2');
    });

    it('counts on from a suffix of 15 digits', () => {
      const thrall = 'thrall-999999999999999';
      strictEqual(uniqueName(thrall, [thrall]), 'thrall-1000000000000000');
    });

    it('keeps a longer suffix and appends to it, never printing an exponent', () => {
      const jaina = 'jaina-1234567890123456789012';
      strictEqual(uniqueName(jaina, [jaina]), `${jaina}-2`);
    });

    it('keeps a suffix past 2^53 and appends to it, never looping forever', () => {
      const arthas = 'arthas-9007199254740992';
      strictEqual(uniqueName(arthas, [arthas, `${arthas}-2`]), `${arthas}-3`);
    });
  });

  it('throws on empty base', () => {
    throws(() => uniqueName('', new Set()), /Invalid base/);
  });
});
