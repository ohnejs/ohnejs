import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { hrefPath } from '../../../src/utils/index.ts';

describe('hrefPath', () => {
  it('drops the query and the hash', () => {
    strictEqual(hrefPath('/jobs?status=failed#top'), '/jobs');
    strictEqual(hrefPath('/docs#install?x'), '/docs');
  });

  it('keeps a bare path', () => {
    strictEqual(hrefPath('/jobs'), '/jobs');
    strictEqual(hrefPath(''), '');
  });
});
