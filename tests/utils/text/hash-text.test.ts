import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { hashText } from '../../../src/utils/index.ts';

describe('hashText', () => {
  it('matches the FNV-1a reference for ASCII', () => {
    strictEqual(hashText(''), 0x811c9dc5);
    strictEqual(hashText('a'), 0xe40c292c);
    strictEqual(hashText('foobar'), 0xbf9cf968);
  });

  it('answers the same number for the same text', () => {
    strictEqual(hashText('Anduin Wrynn'), hashText('Anduin Wrynn'));
  });

  it('stays an unsigned 32-bit integer', () => {
    const hash = hashText('Sylvanas Windrunner of the Forsaken');
    strictEqual(hash >>> 0, hash);
  });
});
