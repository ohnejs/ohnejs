import { deepStrictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { collectContracts } from '../../../src/ohne/contracts/collect-contracts.ts';

describe('collectContracts', () => {
  let root: string;

  before(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'ohne-collect-contracts-')));
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('finds the contract at each layer root, furthest first', async () => {
    for (const name of ['a', 'b', 'c']) mkdirSync(join(root, name));
    writeFileSync(join(root, 'a', 'ohne.contract.ts'), '');
    writeFileSync(join(root, 'c', 'ohne.contract.ts'), '');

    const entries = await collectContracts(
      ['a', 'b', 'c'].map((name) => ({ name, dir: join(root, name) })),
    );

    deepStrictEqual(entries, [
      { layer: 'a', file: join(root, 'a', 'ohne.contract.ts') },
      { layer: 'c', file: join(root, 'c', 'ohne.contract.ts') },
    ]);
  });
});
