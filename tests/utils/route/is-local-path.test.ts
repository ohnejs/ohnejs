import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isLocalPath } from '../../../src/utils/index.ts';

describe('isLocalPath', () => {
  it('accepts a rooted path, its query and hash included', () => {
    strictEqual(isLocalPath('/'), true);
    strictEqual(isLocalPath('/media?details=42#top'), true);
  });

  it('refuses a path a browser reads as another host', () => {
    strictEqual(isLocalPath('//evil.com'), false);
    strictEqual(isLocalPath('/\\evil.com'), false);
    strictEqual(isLocalPath('/\t/evil.com'), false);
    strictEqual(isLocalPath('/\n/evil.com'), false);
    strictEqual(isLocalPath('/\r\\evil.com'), false);
  });

  it('refuses a URL or a relative path', () => {
    strictEqual(isLocalPath('https://evil.com'), false);
    strictEqual(isLocalPath('media'), false);
    strictEqual(isLocalPath(''), false);
  });
});
