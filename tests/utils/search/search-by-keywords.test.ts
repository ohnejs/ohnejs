import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { searchByKeywords } from '../../../src/utils/index.ts';

describe('searchByKeywords', () => {
  it('matches keywords case-insensitively against lowercase items', () => {
    deepStrictEqual(searchByKeywords(['foo', 'bar'], 'FOO'), ['foo']);
  });

  it('matches bare items as given', () => {
    deepStrictEqual(searchByKeywords(['FOO'], 'foo'), []);
  });

  it('sorts by relevance with earlier hits first', () => {
    deepStrictEqual(searchByKeywords(['bar foo', 'foo'], 'foo'), ['foo', 'bar foo']);
  });

  it('requires every keyword to match', () => {
    deepStrictEqual(searchByKeywords(['foo bar', 'foo'], 'foo bar'), ['foo bar']);
  });

  it('keeps every item in order for an empty keyword string', () => {
    deepStrictEqual(searchByKeywords(['b', 'a'], '  '), ['b', 'a']);
  });

  it('accepts a keyword array without splitting', () => {
    deepStrictEqual(searchByKeywords(['foo bar'], ['FOO', 'bar']), ['foo bar']);
  });

  it('searches a single property case-insensitively', () => {
    deepStrictEqual(searchByKeywords([{ name: 'Foo' }, { name: 'Bar' }], 'fo', 'name'), [
      { name: 'Foo' },
    ]);
  });

  it('joins multiple properties into the searched text', () => {
    const items = [
      { label: 'Alpha', value: 'a' },
      { label: 'Beta', value: 'b' },
    ];
    deepStrictEqual(searchByKeywords(items, 'beta b', ['label', 'value']), [items[1]]);
  });

  it('reads dot paths', () => {
    deepStrictEqual(searchByKeywords([{ a: { b: 'foo' } }, { a: { b: 'bar' } }], 'foo', 'a.b'), [
      { a: { b: 'foo' } },
    ]);
  });

  it('renders a missing property as empty text', () => {
    deepStrictEqual(searchByKeywords([{ label: 'foo' }, {}], 'foo', ['label', 'value']), [
      { label: 'foo' },
    ]);
  });
});
