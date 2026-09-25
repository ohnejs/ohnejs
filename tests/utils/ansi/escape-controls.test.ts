import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';
import { inspect } from 'node:util';

import { escapeControls } from '../../../src/utils/ansi/index.ts';

describe('escapeControls', () => {
  it('passes text without control characters through', () => {
    for (const text of ['a.txt', 'C:\\Users\\x', 'é 日本 🙂', 'a\u2028b', 'invoice\u202efdp.exe']) {
      strictEqual(escapeControls(text), text);
    }
  });

  it('writes every C0, DEL and C1 character as `util.inspect` does', () => {
    for (let code = 0; code <= 0x9f; code++) {
      if (code === 0x20) code = 0x7f;
      const char = String.fromCharCode(code);
      strictEqual(escapeControls(char), inspect(char).slice(1, -1));
    }
  });

  it('changes nothing when applied twice', () => {
    const once = escapeControls('a\x1b]8;;https://x\x07b\r\n');
    strictEqual(once, 'a\\x1B]8;;https://x\\x07b\\r\\n');
    strictEqual(escapeControls(once), once);
  });
});
