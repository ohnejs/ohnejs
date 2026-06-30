import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { jsonForScript } from '../../../src/utils/index.ts';

describe('jsonForScript', () => {
  it('round-trips through JSON.parse', () => {
    deepStrictEqual(JSON.parse(jsonForScript({ a: 1, b: 'x' })), { a: 1, b: 'x' });
  });

  it('escapes every `<` so an embedded `</script>` cannot close the element', () => {
    const out = jsonForScript({ html: '</script><!--' });
    strictEqual(out.includes('<'), false);
    deepStrictEqual(JSON.parse(out), { html: '</script><!--' });
  });
});
