import { strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { decodeText } from '../../../src/utils/index.ts';

describe('decodeText', () => {
  it('decodes UTF-8 bytes to a string', () => {
    strictEqual(decodeText(new TextEncoder().encode('café')), 'café');
  });

  it('returns an empty string for empty bytes', () => {
    strictEqual(decodeText(new Uint8Array(0)), '');
  });

  it('throws on malformed UTF-8', () => {
    throws(() => decodeText(new Uint8Array([0xff])), TypeError);
  });

  it('drops a leading byte order mark unless asked to keep it', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x61]);
    strictEqual(decodeText(bytes), 'a');
    strictEqual(decodeText(bytes, { keepBOM: true }), '\uFEFFa');
  });

  it('stays usable after a throw', () => {
    throws(() => decodeText(new Uint8Array([0xff])));
    strictEqual(decodeText(new TextEncoder().encode('ok')), 'ok');
  });
});
