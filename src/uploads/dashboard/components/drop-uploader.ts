import {
  acquireOverlay,
  css,
  h,
  icon,
  type OverlayHandle,
  raiseToTopLayer,
  useRoute,
  when,
} from 'ohnejs/dashboard';
import { isNull, isUndefined, joinPath, onCleanup, parseDuration, ref } from 'ohnejs/utils';

import type { UploadItem } from './upload-queue-state.ts';

import { useUploadsT } from './_messages.ts';
import { uploadsPermissions } from './media-library-data.ts';
import { directoryFromParam, mediaPath, pageFolderHidden } from './media-library-state.ts';
import { uploadFiles } from './upload-queue.ts';

css`
  .o-upload-drop {
    position: fixed;
    top: 0;
    left: 0;
    width: 100dvw;
    height: 100dvh;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    background-color: hsl(var(--ohne-background) / 0.9);
    transition: var(--ohne-transition);
    transition-property: opacity;
    transition-duration: var(--ohne-overlay-transition-duration);
  }

  .o-upload-drop-hidden {
    opacity: 0;
  }

  .o-upload-drop-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    color: hsl(var(--ohne-foreground));
    text-align: center;
    pointer-events: none;
  }

  .o-upload-drop-content svg {
    font-size: 4rem;
  }

  .o-upload-drop-content p {
    font-size: 1.5rem;
    margin-top: 1rem;
    font-weight: 500;
  }

  .o-upload-drop-input {
    display: none;
  }

  @media (max-width: 767px) {
    .o-upload-drop-content svg {
      font-size: 3rem;
    }

    .o-upload-drop-content p {
      font-size: 1.125rem;
    }
  }
`;

/**
 * The window-wide drop target.
 * Dragging files over the window fades in a full-screen panel above every other surface.
 * It opens only for a viewer whose permissions grant upload.
 * A drop uploads into the folder the media library shows, or the root elsewhere.
 * Like the footer's Upload, it never opens over a folder whose own row the read scope hides.
 * A stray drop never navigates the window.
 * Dropped folders are walked and rebuilt under that folder.
 * A drag that starts inside the page never opens the panel, so a dragged thumbnail cannot re-upload itself.
 * Clicking the panel opens the file picker; leaving it, dropping, or losing window focus dismisses it.
 */
export function dropUploader(): HTMLElement {
  const t = useUploadsT();
  const mounted = ref(false);
  const visible = ref(false);
  let dragging = false;
  let ready = false;
  let overlay: OverlayHandle | undefined;
  let timer: number | undefined;

  const uploadFromInput = (): void => {
    const files = input.files;
    if (isNull(files) || files.length === 0) return;
    const directory = targetDirectory();
    void uploadFiles([...files].map((file) => ({ file, directory })));
    input.value = '';
  };

  const input = h('input', {
    type: 'file',
    multiple: true,
    name: 'o-upload-drop-input',
    class: 'o-upload-drop-input',
    onChange: uploadFromInput,
  }) as HTMLInputElement;

  const show = (): void => {
    if (dragging) return;
    dragging = true;
    clearTimeout(timer);
    overlay ??= acquireOverlay();
    if (mounted.value) visible.value = true;
    else mounted.value = true;
    timer = window.setTimeout(() => {
      ready = true;
    }, transitionDuration());
  };

  const hide = (): void => {
    if (!dragging) return;
    dragging = false;
    ready = false;
    clearTimeout(timer);
    visible.value = false;
    overlay?.release();
    overlay = undefined;
    timer = window.setTimeout(() => {
      mounted.value = false;
    }, transitionDuration());
  };

  const prevent = (event: Event): void => event.preventDefault();

  let internal = false;
  const onDragStart = (): void => {
    internal = true;
  };
  const onDragEnd = (): void => {
    internal = false;
  };

  const onDragEnter = (event: DragEvent): void => {
    event.preventDefault();
    if (internal || pageFolderHidden.value || !uploadsPermissions().canUpload) return;
    if (event.dataTransfer?.types.includes('Files')) show();
  };

  const onDrop = async (event: DragEvent): Promise<void> => {
    event.preventDefault();
    hide();
    const items = event.dataTransfer?.items;
    if (isUndefined(items)) return;
    const directory = targetDirectory();
    const entries: FileSystemEntry[] = [];
    const loose: UploadItem[] = [];
    for (const item of items) {
      const entry = item.webkitGetAsEntry();
      if (!isNull(entry)) {
        entries.push(entry);
        continue;
      }
      // Some drag sources hand over a file whose entry is null.
      const file = item.getAsFile();
      if (!isNull(file)) loose.push({ file, directory });
    }
    const payload = [...(await collectFiles(entries, directory)), ...loose];
    if (payload.length > 0) void uploadFiles(payload);
  };

  const panel = (): HTMLElement => {
    const el = h(
      'div',
      {
        class: () =>
          'o-upload-drop ohne-allow-interaction' + (visible.value ? '' : ' o-upload-drop-hidden'),
        onClick: () => input.click(),
        onDragleave: (event: DragEvent) => {
          event.preventDefault();
          if (ready) hide();
        },
        onDragover: prevent,
        onDrop: (event: DragEvent) => void onDrop(event),
        onMouseleave: hide,
      },
      h(
        'div',
        { class: 'o-upload-drop-content' },
        icon('upload'),
        h('p', null, () => t('uploads.dashboard.dropToUpload')),
      ),
    );
    // A forced layout at opacity 0 first, so lifting the class fades the panel in instead of snapping.
    queueMicrotask(() => {
      raiseToTopLayer(el);
      void el.offsetWidth;
      if (dragging) visible.value = true;
    });
    return el;
  };

  window.addEventListener('dragstart', onDragStart);
  window.addEventListener('dragend', onDragEnd);
  window.addEventListener('dragenter', onDragEnter);
  window.addEventListener('dragover', prevent);
  window.addEventListener('drop', prevent);
  window.addEventListener('blur', hide);
  onCleanup(() => {
    window.removeEventListener('dragstart', onDragStart);
    window.removeEventListener('dragend', onDragEnd);
    window.removeEventListener('dragenter', onDragEnter);
    window.removeEventListener('dragover', prevent);
    window.removeEventListener('drop', prevent);
    window.removeEventListener('blur', hide);
    clearTimeout(timer);
    overlay?.release();
  });

  return h(
    'div',
    null,
    when(() => mounted.value, panel),
    input,
  );
}

/**
 * The folder uploads land in: the media library's current folder while it is the page, else the root.
 */
function targetDirectory(): string {
  const route = useRoute();
  if (isNull(route) || !route.path.startsWith(`${mediaPath('')}/`)) return '';
  return directoryFromParam(route.params.path);
}

/**
 * Every file beneath the dropped entries, each bound for `target` plus the folders above it in the drop.
 */
async function collectFiles(roots: FileSystemEntry[], target: string): Promise<UploadItem[]> {
  const items: UploadItem[] = [];
  const queue = [...roots];
  while (queue.length > 0) {
    const entry = queue.shift();
    if (isUndefined(entry)) break;
    if (entry.isFile) {
      const file = await fileOf(entry as FileSystemFileEntry);
      items.push({ file, directory: directoryOf(entry.fullPath, target) });
    } else if (entry.isDirectory) {
      queue.push(...(await entriesOf((entry as FileSystemDirectoryEntry).createReader())));
    }
  }
  return items;
}

/**
 * The folder a dropped file lands in: `target` joined with the folders of its `fullPath`.
 */
function directoryOf(fullPath: string, target: string): string {
  const lastSlash = fullPath.lastIndexOf('/');
  return lastSlash > 0 ? joinPath(target, fullPath.slice(1, lastSlash)) : target;
}

/**
 * The `File` behind a dropped file entry.
 */
function fileOf(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

/**
 * Every entry of a directory; a reader hands them out in batches until an empty one.
 */
async function entriesOf(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  const entries: FileSystemEntry[] = [];
  let batch = await readBatch(reader);
  while (batch.length > 0) {
    entries.push(...batch);
    batch = await readBatch(reader);
  }
  return entries;
}

/**
 * One batch of a directory reader, empty once it is exhausted.
 */
function readBatch(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject));
}

/**
 * The overlay transition duration off the body, in milliseconds; `300` when unset.
 */
function transitionDuration(): number {
  const raw = getComputedStyle(document.body)
    .getPropertyValue('--ohne-overlay-transition-duration')
    .trim();
  return raw === '' ? 300 : parseDuration(raw);
}
