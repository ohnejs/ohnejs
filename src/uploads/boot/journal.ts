import { hook } from 'ohnejs';

import { drainJournal } from '../storage/journal.ts';
import { useStorage } from '../storage/use-storages.ts';
import { sweepStaged } from '../uploads/_stage.ts';

const STAGED_TTL = 24 * 60 * 60 * 1000;

hook('schema:synced', async () => {
  // Built before the drain, which only warns, so a storage that cannot be built throws its full error once.
  useStorage();
  await drainJournal();
  // Another instance may share the storage and still be staging, so only stale objects are swept.
  await sweepStaged(Date.now() - STAGED_TTL);
});
