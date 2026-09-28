import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { listenOrigin } from '../../../src/utils/net/index.ts';

describe('listenOrigin', () => {
  it('builds the origin from a named host', () => {
    strictEqual(listenOrigin('127.0.0.1', 9000), 'http://127.0.0.1:9000');
    strictEqual(listenOrigin('dev.local', 9001), 'http://dev.local:9001');
  });

  it('reaches an absent or wildcard host at localhost', () => {
    strictEqual(listenOrigin(undefined, 9000), 'http://localhost:9000');
    strictEqual(listenOrigin('0.0.0.0', 9000), 'http://localhost:9000');
    strictEqual(listenOrigin('::', 9000), 'http://localhost:9000');
  });

  it('brackets an IPv6 address', () => {
    strictEqual(listenOrigin('::1', 9000), 'http://[::1]:9000');
    strictEqual(listenOrigin('fd00::1', 9000), 'http://[fd00::1]:9000');
  });

  it('yields an origin the URL parser accepts', () => {
    strictEqual(new URL(listenOrigin('::1', 9000)).origin, 'http://[::1]:9000');
  });
});
