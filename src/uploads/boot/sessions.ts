import { hook, ohneError } from 'ohnejs';
import { formatBytes, isUndefined, parseBytes } from 'ohnejs/utils';

import { useUploadsConfig } from '../config.ts';
import { useStorage } from '../storage/use-storages.ts';

// Before the socket opens, so no session ever opens on a grid the storage refuses.
hook('schema:synced', assertChunkSize);

/**
 * Refuses a `uploads.chunkSize` below the smallest part the storage stores, with an error block.
 * Each chunk but the last is stored as one part, so a smaller size would fail every multi-chunk session.
 * A storage without `parts` opens no session, so any size passes.
 */
function assertChunkSize(): void {
  const { parts } = useStorage();
  const { storage, chunkSize } = useUploadsConfig();
  if (isUndefined(parts) || parseBytes(chunkSize) >= parts.minSize) return;
  const min = formatBytes(parts.minSize);
  throw ohneError({
    title: `\`uploads.chunkSize\` is too small for the \`${storage}\` storage`,
    body: [
      `Each chunk is stored as one part, and \`${storage}\` needs every part but the last to hold \`${min}\` or more.`,
      `You set \`${chunkSize}\`.`,
      '',
      `Raise \`uploads.chunkSize\` to \`${min}\` or more.`,
    ],
  });
}
