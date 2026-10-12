import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';

import { sleep } from '../../../src/utils/index.ts';

setFlagsFromString('--expose-gc');
const gc = runInNewContext('gc') as () => void;

/**
 * Forces several full collections, yielding between them so weak cells and finalizers settle.
 */
export async function collectGarbage(): Promise<void> {
  for (let pass = 0; pass < 5; pass++) {
    gc();
    await sleep(10);
  }
}
