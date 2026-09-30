import { activeContentLocale } from 'app/components/content-language-switcher.ts';
import { type Child, navigate, toast, when } from 'ohnejs/dashboard';
import { isNull, isNullish, isUndefined, onCleanup, ref, untracked } from 'ohnejs/utils';

import type { UploadRecord } from '../../uploads/types.ts';
import type { UploadsTranslate } from './_messages.ts';
import type { TargetDirectory } from './_target-tree.ts';
import type { MediaView } from './media-library-state.ts';
import type { MediaActions } from './media-library.ts';

import { useUploadsT } from './_messages.ts';
import { createFolderPopup } from './create-folder-popup.ts';
import {
  detailsQueryParam,
  loadUpload,
  mediaDetailsPopup,
  setDetailsQueryParam,
} from './media-details-popup.ts';
import { mediaPath } from './media-library-state.ts';
import { loadTargetTree, movePopup } from './move-popup.ts';
import { renamePopup } from './rename-popup.ts';

/**
 * The popups a media page hosts: the actions that open them, and the regions they render in.
 */
export interface MediaPopups {
  /**
   * The create-folder, rename, move, and details actions, each opening its popup.
   */
  actions: MediaActions;

  /**
   * The reactive regions the popups mount in; render them anywhere on the page.
   */
  hosts: Child;
}

interface PendingMove {
  records: readonly UploadRecord[];
  tree: TargetDirectory;
}

/**
 * Wires the media popups to a page's view.
 * The create-folder, rename, and move popups open from their actions.
 * The details popup follows the `details` query parameter, so a deep link opens it and closing clears it.
 * A record already on the page opens without a read; any other is fetched.
 * With a content locale chosen, the read always happens, so the description arrives at that locale.
 */
export function mediaPopups(view: MediaView): MediaPopups {
  const t = useUploadsT();
  const folderTarget = ref<string | null>(null);
  const renaming = ref<UploadRecord | null>(null);
  const moving = ref<PendingMove | null>(null);

  const hosts: Child = [
    when(
      () => !isNull(folderTarget.value),
      () => {
        createFolderPopup({
          directory: untracked(() => folderTarget.value) ?? '',
          onClose: (close) =>
            void close().then(() => {
              folderTarget.value = null;
            }),
        });
        return null;
      },
    ),
    when(
      () => !isNull(renaming.value),
      () => {
        const record = untracked(() => renaming.value);
        if (isNull(record)) return null;
        renamePopup(record, {
          onClose: (close) =>
            void close().then(() => {
              renaming.value = null;
            }),
        });
        return null;
      },
    ),
    when(
      () => !isNull(moving.value),
      () => {
        const pending = untracked(() => moving.value);
        if (isNull(pending)) return null;
        movePopup({
          records: pending.records,
          tree: pending.tree,
          onClose: (close) =>
            void close().then(() => {
              moving.value = null;
            }),
        });
        return null;
      },
    ),
    detailsHost(view, t),
  ];

  return {
    actions: {
      onCreateFolder: (directory) => {
        folderTarget.value = directory;
      },
      onRename: (record) => {
        renaming.value = record;
      },
      onMove: (records) => {
        void loadTargetTree(records).then((tree) => {
          moving.value = { records, tree };
        });
      },
      onDetails: (record) => setDetailsQueryParam(record.UUID),
    },
    hosts,
  };
}

/**
 * The region that opens the details popup while the `details` query parameter names a file.
 * A file the read cannot find toasts and clears the parameter.
 * A folder has no details, so naming one opens the folder instead.
 */
function detailsHost(view: MediaView, t: UploadsTranslate): Child {
  return when(
    () => !isUndefined(detailsQueryParam()),
    () => {
      const uuid = untracked(detailsQueryParam) ?? '';
      const locale = untracked(activeContentLocale);
      const known = untracked(() => view.uploads.value).find((record) => record.UUID === uuid);
      const seed = !isUndefined(known) && isUndefined(locale) ? known : null;
      const record = ref<UploadRecord | null>(seed);
      let live = true;
      onCleanup(() => {
        live = false;
      });
      if (isNull(seed)) {
        void loadUpload(uuid, locale).then((loaded) => {
          if (!live) return;
          if (isNullish(loaded)) {
            toast(t(isNull(loaded) ? 'dashboard.recordNotFound' : 'dashboard.unreachable'), {
              type: 'error',
            });
            setDetailsQueryParam(null);
          } else {
            record.value = loaded;
          }
        });
      }
      return when(
        () => !isNull(record.value),
        () => {
          const loaded = untracked(() => record.value);
          if (isNull(loaded)) return null;
          if (loaded.kind === 'folder') {
            navigate(mediaPath(loaded.path), { replace: true });
            return null;
          }
          mediaDetailsPopup(loaded, {
            onClose: (close) => void close().then(() => setDetailsQueryParam(null)),
          });
          return null;
        },
      );
    },
  );
}
