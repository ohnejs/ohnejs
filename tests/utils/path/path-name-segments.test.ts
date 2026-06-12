import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { pathNameSegments } from '../../../src/utils/index.ts';

describe('pathNameSegments', () => {
  it('returns an empty array for an empty input', () => {
    deepStrictEqual(pathNameSegments(''), []);
  });

  it('returns an empty array for a bare dot', () => {
    deepStrictEqual(pathNameSegments('.'), []);
  });

  it('returns an empty array when the path is just `index.ts`', () => {
    deepStrictEqual(pathNameSegments('index.ts'), []);
  });

  it('strips the extension on the last segment', () => {
    deepStrictEqual(pathNameSegments('foo/bar.ts'), ['foo', 'bar']);
  });

  it('keeps a bare name with no extension', () => {
    deepStrictEqual(pathNameSegments('foo/bar'), ['foo', 'bar']);
  });

  it('collapses a trailing `index` segment into its parent', () => {
    deepStrictEqual(pathNameSegments('foo/index.ts'), ['foo']);
    deepStrictEqual(pathNameSegments('foo/bar/index.ts'), ['foo', 'bar']);
  });

  it('only collapses `index` at the tail', () => {
    deepStrictEqual(pathNameSegments('index/foo.ts'), ['index', 'foo']);
    deepStrictEqual(pathNameSegments('foo/index/bar.ts'), ['foo', 'index', 'bar']);
  });

  it('normalizes leading `./` and `..` segments', () => {
    deepStrictEqual(pathNameSegments('./foo/bar.ts'), ['foo', 'bar']);
    deepStrictEqual(pathNameSegments('foo/../bar.ts'), ['bar']);
  });

  it('treats backslashes as separators', () => {
    deepStrictEqual(pathNameSegments('src\\foo\\bar.ts'), ['src', 'foo', 'bar']);
  });

  it('drops segments with no ASCII alphanumeric characters', () => {
    deepStrictEqual(pathNameSegments('foo/---/bar.ts'), ['foo', 'bar']);
    deepStrictEqual(pathNameSegments('---/foo.ts'), ['foo']);
  });

  it('preserves multi-dot filenames past the leading dot of the extension', () => {
    deepStrictEqual(pathNameSegments('foo.bar.ts'), ['foo.bar']);
  });
});
