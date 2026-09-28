import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { childPath } from '../../../src/utils/index.ts';

describe('childPath', () => {
  it('appends the name after one slash', () => {
    strictEqual(childPath('/app', 'a.ts'), '/app/a.ts');
    strictEqual(childPath('/', 'etc'), '/etc');
    strictEqual(childPath('C:/', 'app'), 'C:/app');
  });

  it('keeps a backslash and `..` in the name', () => {
    strictEqual(childPath('/app', 'x\\y.ts'), '/app/x\\y.ts');
    strictEqual(childPath('/app', 'd\\..'), '/app/d\\..');
    strictEqual(childPath('/app', '..\\..'), '/app/..\\..');
  });
});
