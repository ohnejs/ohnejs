import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { displayURL } from '../../../src/utils/index.ts';

describe('displayURL', () => {
  it('drops the scheme and a trailing slash', () => {
    strictEqual(displayURL('https://example.com/'), 'example.com');
    strictEqual(displayURL('https://example.com/docs/'), 'example.com/docs');
  });

  it('keeps the path', () => {
    strictEqual(
      displayURL('https://mein.webgepflegt.de/K7M4X-Q2PZR'),
      'mein.webgepflegt.de/K7M4X-Q2PZR',
    );
  });

  it('keeps a port and drops the query and the fragment', () => {
    strictEqual(displayURL('http://localhost:3000/docs/?q=1#top'), 'localhost:3000/docs');
  });
});
