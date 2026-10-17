import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import {
  captureGroup,
  classifyGroups,
} from '../../../../src/utils/highlight/languages/_capture-group.ts';

describe('captureGroup', () => {
  it('returns the index of the group that matched', () => {
    strictEqual(captureGroup(/(a)|(b)|(c)/.exec('c')!), 3);
  });

  it('returns -1 for a match outside every group', () => {
    strictEqual(captureGroup(/(a)|b/.exec('b')!), -1);
  });

  it('counts an empty capture as matched', () => {
    strictEqual(captureGroup(/(x?)b/.exec('b')!), 1);
  });
});

describe('classifyGroups', () => {
  const classify = classifyGroups(['comment', 'string']);

  it('maps group n to the nth kind', () => {
    strictEqual(classify(/(#.*)|('.*')/.exec('# a')!, '# a'), 'comment');
    strictEqual(classify(/(#.*)|('.*')/.exec("'a'")!, "'a'"), 'string');
  });

  it('leaves an ungrouped match plain', () => {
    strictEqual(classify(/(#.*)|\w+/.exec('a')!, 'a'), undefined);
  });
});
