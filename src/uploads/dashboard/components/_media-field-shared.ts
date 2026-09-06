import {
  apiUpload,
  attachTooltip,
  button,
  type Child,
  type FieldControl,
  type FieldControlContext,
  fallbackLabel,
  h,
  icon,
  type IconName,
  toast,
  when,
} from 'ohne/dashboard';
import { isNull, isUndefined, onCleanup, type Ref, ref, untracked } from 'ohne/utils';

import type { UploadRecord } from '../../uploads/types.ts';
import type { DetailsTab } from './media-details-state.ts';
import type { MediaItemDisabled } from './media-image-item.ts';

import { runBatched } from './_batch.ts';
import { mediaRecords } from './_media-records.ts';
import { type UploadsTranslate, useUploadsT } from './_messages.ts';
import { readWireError } from './_wire-error.ts';
import { mediaDetailsPopup } from './media-details-popup.ts';
import { mediaFileName } from './media-file-name.ts';
import { detailsHref } from './media-image-item.ts';
import { BATCH_LIMIT, refreshMedia } from './media-library-data.ts';
import { type MediaLibraryPopupOptions, mediaLibraryPopup } from './media-library-popup.ts';
import { type UploadConstraints, validateUpload } from './media-picker-validation.ts';

/**
 * Options for `hiddenFileInput`.
 */
export interface HiddenFileInputOptions {
  /**
   * The `accept` attribute; omitted accepts every file.
   */
  accept?: string;

  /**
   * Whether several files may be picked at once.
   *
   * @default
   * false
   */
  multiple?: boolean;

  /**
   * Called with the picked files; the input then resets, so the same file can be picked again.
   */
  onFiles(files: File[]): void;
}

/**
 * Options for `detailsHost`.
 */
export interface DetailsHostOptions {
  /**
   * The tab the popup opens on, read once per open.
   *
   * @default
   * 'details'
   */
  tab?(): DetailsTab;

  /**
   * Called with the record once the popup's Delete has removed it; the control drops its link.
   */
  onDeleted?(record: UploadRecord): void;
}

/**
 * How one field upload ended: the stored record, or the message telling why it failed.
 */
type UploadResult = { ok: true; record: UploadRecord } | { ok: false; error: string };

const OCTET_STREAM = 'application/octet-stream';

const NOT_DISABLED: MediaItemDisabled = { value: false };

/**
 * Whether a click carries none of the modifiers that ask for a new tab, so the dashboard handles it itself.
 */
export function isPlainClick(event: MouseEvent): boolean {
  return !event.metaKey && !event.ctrlKey && !event.shiftKey;
}

/**
 * The text standing in for a linked upload the server no longer has.
 */
export function notFoundLabel(t: UploadsTranslate, image: boolean, uuid: string): string {
  const key = image ? 'uploads.dashboard.imageNotFound' : 'uploads.dashboard.fileNotFound';
  return `${t(key)} (${fallbackLabel(uuid)})`;
}

/**
 * The picker's ineligibility resolver for a field: a file outside the constraints greys out with the reason.
 * Folders are never ineligible; they are navigated, not picked.
 */
export function ineligibility(
  constraints: UploadConstraints,
  image: boolean,
): (record: UploadRecord) => MediaItemDisabled {
  const t = useUploadsT();
  return (record) => {
    if (record.kind === 'folder') return NOT_DISABLED;
    const verdict = validateUpload(record, constraints, image);
    if (verdict.ok) return NOT_DISABLED;
    return { value: true, reason: t(verdict.reason.key, verdict.reason.params) };
  };
}

/**
 * A hidden file input a visible button clicks open.
 */
export function hiddenFileInput(options: HiddenFileInputOptions): HTMLInputElement {
  const input = h('input', {
    type: 'file',
    hidden: true,
    accept: options.accept,
    multiple: options.multiple === true ? true : undefined,
    onChange: () => {
      const files = [...(input.files ?? [])];
      if (files.length > 0) options.onFiles(files);
      input.value = '';
    },
  }) as HTMLInputElement;
  return input;
}

/**
 * An outline icon button with a tooltip.
 */
export function iconButton(
  glyph: IconName,
  tooltip: () => string,
  onClick: (event: MouseEvent) => void,
  disabled?: () => boolean,
): HTMLElement {
  const el = button(icon(glyph), { variant: 'outline', disabled, onClick });
  onCleanup(attachTooltip(el, tooltip));
  return el;
}

/**
 * Uploads files into the root folder and answers the `UUID`s of those the field accepts, in file order.
 * A file the server refuses, or never receives, toasts why and is left out.
 * A stored one the constraints reject toasts its reason.
 * Every open media library reloads once something landed.
 */
export async function uploadForField(
  files: readonly File[],
  constraints: UploadConstraints,
  image: boolean,
): Promise<string[]> {
  const t = useUploadsT();
  const results = await runBatched(files, BATCH_LIMIT, sendUpload);
  const accepted: string[] = [];
  let landed = false;
  for (const result of results) {
    const outcome: UploadResult =
      result.status === 'fulfilled'
        ? result.value
        : { ok: false, error: t('dashboard.unreachable') };
    if (!outcome.ok) {
      toast(outcome.error, { type: 'error' });
      continue;
    }
    landed = true;
    mediaRecords.seed(outcome.record);
    const verdict = validateUpload(outcome.record, constraints, image);
    if (verdict.ok) accepted.push(outcome.record.UUID);
    else toast(t(verdict.reason.key, verdict.reason.params), { type: 'error' });
  }
  if (landed) refreshMedia();
  return accepted;
}

/**
 * The region hosting a control's picker while `open` is set; the popup closes itself back to `false`.
 * The request is read once per open, untracked, so a model change never rebuilds an open picker.
 */
export function pickerHost(
  open: Ref<boolean>,
  request: () => Omit<MediaLibraryPopupOptions, 'onClose'>,
): Child {
  return when(
    () => open.value,
    () => {
      mediaLibraryPopup({
        ...untracked(request),
        onClose: (close) =>
          void close().then(() => {
            open.value = false;
          }),
      });
      return null;
    },
  );
}

/**
 * The region hosting the details popup for the record `target` names; closing clears it back to `null`.
 * A saved edit or a replaced file re-seeds the cache, so every binding on the record follows.
 */
export function detailsHost(
  target: Ref<UploadRecord | null>,
  options: DetailsHostOptions = {},
): Child {
  return when(
    () => !isNull(target.value),
    () => {
      const record = untracked(() => target.value);
      if (isNull(record)) return null;
      mediaDetailsPopup(record, {
        tab: untracked(() => options.tab?.()),
        onUpdated: (updated) => mediaRecords.seed(updated),
        onDeleted: options.onDeleted,
        onClose: (close) =>
          void close().then(() => {
            target.value = null;
          }),
      });
      return null;
    },
  );
}

/**
 * The outline chip naming a linked file, its path in a tooltip.
 * A plain click hands the record to `onOpen`; a modified click opens the media page's deep link in a new tab.
 * A file the server no longer has renders a disabled chip saying so; nothing renders while it loads.
 */
export function fileChip(
  record: () => UploadRecord | null | undefined,
  uuid: () => string,
  image: boolean,
  onOpen: (record: UploadRecord) => void,
): Child {
  const t = useUploadsT();
  return () => {
    const current = record();
    if (isUndefined(current)) return null;
    if (isNull(current)) {
      return button(h('span', { class: 'ohne-truncate' }, notFoundLabel(t, image, uuid())), {
        variant: 'outline',
        class: 'ohne-shrink',
        disabled: () => true,
      });
    }
    const el = button(mediaFileName(current.name, { title: true }), {
      variant: 'outline',
      class: 'ohne-shrink',
      href: detailsHref(current, true),
      target: '_blank',
      onClick: (event) => {
        if (!isPlainClick(event)) return;
        event.preventDefault();
        onOpen(current);
      },
    });
    onCleanup(attachTooltip(el, current.path));
    return el;
  };
}

/**
 * The control a viewer without read access to `Uploads` gets: the no-permission line.
 * The stored value rides through untouched, so a whole-item write never blanks the field.
 */
export function noPermissionControl(
  context: FieldControlContext,
  t: UploadsTranslate,
): FieldControl {
  let base = context.initial;
  const routed = ref('');
  return {
    element: h('p', { class: 'ohne-muted' }, () => t('uploads.dashboard.noPermission')),
    read() {
      return isUndefined(base) ? {} : { value: base };
    },
    setErrors(errors) {
      routed.value = errors[''] ?? '';
      for (const [key, message] of Object.entries(errors)) {
        if (key !== '') return message;
      }
      return '';
    },
    error: () => routed.value,
    dirty: () => false,
    focus() {},
    revert() {
      routed.value = '';
    },
    rebase(value) {
      base = value;
      routed.value = '';
    },
  };
}

/**
 * Sends one file as the raw body of `POST /uploads` into the root folder.
 * A `2xx` answers the stored record; a refusal answers its first field error, else its wire message.
 */
async function sendUpload(file: File): Promise<UploadResult> {
  const response = await apiUpload(
    `POST /uploads?directory=&name=${encodeURIComponent(file.name)}`,
    file,
    { headers: { 'content-type': file.type || OCTET_STREAM } },
  );
  if (response.ok) return { ok: true, record: (await response.json()) as UploadRecord };
  const { message } = await readWireError(response);
  return { ok: false, error: message };
}
