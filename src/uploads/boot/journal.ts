import { hook } from 'ohne';

import { drainJournal } from '../storage/journal.ts';
import { useStorage } from '../storage/use-storages.ts';
import { TEMP_PREFIX } from '../uploads/path.ts';

// Before the socket opens, so no live upload is staged when the sweep runs.
hook('schema:synced', async () => {
  await drainJournal();
  // After the replay, whatever is still staged belongs to a row that never committed.
  await useStorage().delete(TEMP_PREFIX);
});
