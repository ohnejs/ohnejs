import { loadPage } from 'app/components/collection-table-data.ts';
import {
  button,
  h,
  icon,
  openDialog,
  popup,
  type Popup,
  type PopupClose,
  toast,
} from 'ohnejs/dashboard';
import { effect, isEmpty, isUndefined, joinPath, ref } from 'ohnejs/utils';

import type { UploadRecord } from '../../uploads/types.ts';

import { useUploadsT } from './_messages.ts';
import { buildTargetTree, hasValidTarget, type TargetDirectory } from './_target-tree.ts';
import { moveUploads } from './media-library-data.ts';
import { movePlan } from './media-library-state.ts';
import { mediaTargetDirectory } from './media-target-directory.ts';

/**
 * Options for `movePopup`.
 */
export interface MovePopupOptions {
  /**
   * The records to move.
   */
  records: readonly UploadRecord[];

  /**
   * The target tree to show first, loaded through `loadTargetTree` before the popup opens.
   */
  tree: TargetDirectory;

  /**
   * Called with the number of records moved once the batch has settled.
   */
  onMoved?(count: number): void;

  /**
   * Called when the popup asks to close, with its animated close function.
   * The caller awaits it and then disposes the region that created the popup.
   */
  onClose(close: PopupClose): void;
}

// The default page ceiling; a lower app ceiling only means more pages.
const FOLDERS_PER_PAGE = 500;

/**
 * Loads every folder and builds the target tree for moving `records`.
 * Folders arrive in pages, so a library of any size resolves whole.
 */
export async function loadTargetTree(records: readonly UploadRecord[]): Promise<TargetDirectory> {
  const t = useUploadsT();
  return buildTargetTree(await loadFolderPaths(), records, t('uploads.dashboard.rootFolder'));
}

/**
 * The move popup: the folder tree, every folder a button, with New subfolder inline on each.
 * The selection itself and everything inside it is disabled; with no folder left, the popup says so.
 * Picking a folder closes the popup, then checks the destination for taken names.
 * Every taken name is skipped after one confirmation; the rest move with bounded concurrency.
 * Create it inside a reactive region; dispose the region after `onClose`'s close resolves.
 */
export function movePopup(options: MovePopupOptions): Popup {
  const t = useUploadsT();
  const records = options.records;
  const tree = ref<TargetDirectory>(options.tree);

  const reload = async (): Promise<void> => {
    tree.value = await loadTargetTree(records);
  };

  const moveTo = async (directory: string): Promise<void> => {
    const plan = movePlan(records, directory);
    const taken = await takenNames(
      directory,
      plan.map((record) => record.name),
    );
    const movable = plan.filter((record) => !taken.has(record.name));
    if (taken.size > 0) {
      if (isEmpty(movable)) {
        toast(t('uploads.dashboard.itemsConflict'), { type: 'error' });
        return;
      }
      const action = await openDialog({
        content: t('uploads.dashboard.moveConflictConfirm', {
          count: plan.length - movable.length,
        }),
        actions: [
          { name: 'cancel', label: t('dashboard.cancel') },
          { name: 'move', label: t('uploads.dashboard.move'), variant: 'primary' },
        ],
      });
      if (action !== 'move') return;
    }
    options.onMoved?.(await moveUploads(movable, directory));
  };

  const select = (target: TargetDirectory): void => {
    options.onClose(handle.close);
    void moveTo(target.path);
  };

  const closeButton = button(icon('x'), {
    size: -2,
    variant: 'ghost',
    class: 'ohne-ml-auto',
    onClick: () => options.onClose(handle.close),
  });
  effect(() => {
    closeButton.title = t('dashboard.close');
  });

  const handle = popup(
    () => {
      const root = tree.value;
      if (!hasValidTarget(root)) {
        return h('p', { class: 'ohne-muted' }, () => t('uploads.dashboard.noFolders'));
      }
      return h(
        'div',
        null,
        mediaTargetDirectory(root, { onSelect: select, onCreated: () => void reload() }),
      );
    },
    {
      size: -1,
      width: '32rem',
      fullHeight: 'auto',
      header: h(
        'div',
        { class: 'ohne-row' },
        h('span', { class: 'ohne-medium' }, () => t('uploads.dashboard.moveTo')),
        closeButton,
      ),
      footer: h(
        'div',
        { class: 'ohne-row' },
        button(() => t('dashboard.close'), {
          variant: 'outline',
          class: 'ohne-ml-auto',
          onClick: () => options.onClose(handle.close),
        }),
      ),
      onClose: (close) => options.onClose(close),
    },
  );

  return handle;
}

/**
 * Every folder's path, ordered by path, read page by page.
 * A failed page ends the read with what arrived, so the popup still shows a tree.
 */
async function loadFolderPaths(): Promise<string[]> {
  const paths: string[] = [];
  let page = 1;
  let lastPage = 1;
  while (page <= lastPage) {
    const loaded = await loadPage('uploads', {
      where: { kind: 'folder' },
      select: ['directory', 'name'],
      order: ['directory', 'name'],
      page,
      perPage: FOLDERS_PER_PAGE,
    });
    if (isUndefined(loaded)) break;
    for (const row of loaded.records) {
      paths.push(joinPath(String(row.directory), String(row.name)));
    }
    lastPage = loaded.lastPage;
    page += 1;
  }
  return paths;
}

/**
 * The names among `names` that a row already holds in `directory`.
 * A failed read answers none, so the batch runs and any clash surfaces as a `422` toast.
 */
async function takenNames(directory: string, names: readonly string[]): Promise<Set<string>> {
  if (isEmpty(names)) return new Set();
  const loaded = await loadPage('uploads', {
    where: { directory, name: { in: names } },
    select: ['name'],
    page: 1,
    perPage: names.length,
  });
  if (isUndefined(loaded)) return new Set();
  return new Set(loaded.records.map((row) => String(row.name)));
}
