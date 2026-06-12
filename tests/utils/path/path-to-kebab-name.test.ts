import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { pathToKebabName } from '../../../src/utils/index.ts';

describe('pathToKebabName', () => {
  it('joins segments with `-` and kebab-cases each', () => {
    strictEqual(pathToKebabName('foo/bar-baz.ts'), 'foo-bar-baz');
  });

  it('collapses a trailing `index` into its parent', () => {
    strictEqual(pathToKebabName('foo/index.ts'), 'foo');
    strictEqual(pathToKebabName('foo/bar/index.ts'), 'foo-bar');
  });

  it('returns an empty string for an empty path', () => {
    strictEqual(pathToKebabName(''), '');
  });

  it('returns an empty string when the path is just `index.ts`', () => {
    strictEqual(pathToKebabName('index.ts'), '');
  });

  it('flattens word boundaries inside any segment', () => {
    strictEqual(pathToKebabName('FooBar/baz.ts'), 'foo-bar-baz');
    strictEqual(pathToKebabName('foo/barBaz.ts'), 'foo-bar-baz');
  });

  it('lowercases all-caps acronym segments', () => {
    strictEqual(pathToKebabName('HTML/parser.ts'), 'html-parser');
    strictEqual(pathToKebabName('foo/BAR.ts'), 'foo-bar');
  });

  it('treats backslashes as separators', () => {
    strictEqual(pathToKebabName('src\\foo\\bar.ts'), 'src-foo-bar');
  });

  it('normalizes a leading `./`', () => {
    strictEqual(pathToKebabName('./foo/bar.ts'), 'foo-bar');
  });

  it('skips degenerate segments', () => {
    strictEqual(pathToKebabName('foo/---/bar.ts'), 'foo-bar');
  });
});
