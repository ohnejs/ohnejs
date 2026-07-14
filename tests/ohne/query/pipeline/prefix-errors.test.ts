import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { prefixErrors, prefixPath } from '../../../../src/ohne/query/pipeline/prefix-errors.ts';

describe('prefixPath', () => {
  it('names the prefix itself for an empty key', () => {
    strictEqual(prefixPath('meta', ''), 'meta');
  });

  it('concatenates a bracket key bare', () => {
    strictEqual(prefixPath('sections', '[0]'), 'sections[0]');
    strictEqual(prefixPath('sections', '[0].title'), 'sections[0].title');
  });

  it('joins any other key with a dot', () => {
    strictEqual(prefixPath('meta', 'title'), 'meta.title');
  });
});

describe('prefixErrors', () => {
  it('re-keys every entry under the prefix', () => {
    const out = prefixErrors('meta', { note: 'a', '[0].x': 'b' });
    strictEqual(out['meta.note'], 'a');
    strictEqual(out['meta[0].x'], 'b');
  });
});
