import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { joinURL } from '../../../src/utils/index.ts';

describe('joinURL', () => {
  it('keeps the scheme separator', () => {
    strictEqual(
      joinURL('https://api.anthropic.com', 'v1/messages'),
      'https://api.anthropic.com/v1/messages',
    );
  });

  it('joins with exactly one slash', () => {
    strictEqual(joinURL('https://example.com/', '/v1/'), 'https://example.com/v1');
    strictEqual(joinURL('https://example.com//api//', '//chat'), 'https://example.com//api/chat');
  });

  it('skips empty segments and trims a bare base', () => {
    strictEqual(joinURL('http://127.0.0.1:4000/', '', 'a', 'b'), 'http://127.0.0.1:4000/a/b');
    strictEqual(joinURL('https://example.com/v1/'), 'https://example.com/v1');
  });
});
