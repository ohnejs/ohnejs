import { ohneError, useConfig } from 'ohnejs';

assertCollections();

/**
 * Refuses a `disable.collections` that drops `AITurns`, with an error block.
 * Every turn lives in its row between steps, so the assistant cannot run without it.
 * It runs as the file loads, since a sync without the collection drops its empty table.
 */
function assertCollections(): void {
  if (!useConfig().disable.collections.includes('AITurns')) return;
  throw ohneError({
    title: 'The assistant layer needs `AITurns`',
    body: [
      'You list it in `disable.collections`, but the layer keeps every turn there between steps.',
      '',
      'Remove `AITurns` from `disable.collections`.',
    ],
  });
}
