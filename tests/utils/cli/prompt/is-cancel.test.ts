import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { CANCEL, isCancel } from '../../../../src/utils/cli/index.ts';

describe('isCancel', () => {
  it('is true only for the CANCEL sentinel', () => {
    strictEqual(isCancel(CANCEL), true);
    strictEqual(isCancel('CANCEL'), false);
    strictEqual(isCancel(undefined), false);
    strictEqual(isCancel(Symbol('cancel')), false);
  });
});
