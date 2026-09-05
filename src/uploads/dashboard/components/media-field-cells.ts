import { attachTooltip, css, dimMark, type FieldType, h, icon } from 'ohne/dashboard';
import { isArray, isNull, isString, isUndefined, onCleanup } from 'ohne/utils';

import type { UploadRecord } from '../../uploads/types.ts';

import { notFoundLabel } from './_media-field-shared.ts';
import { mediaRecords } from './_media-records.ts';
import { useUploadsT } from './_messages.ts';
import { fileIcon } from './media-file-item.ts';
import { mediaFileName } from './media-file-name.ts';
import { previewURL } from './media-library-data.ts';
import { isDisplayableImage } from './media-library-state.ts';

css`
  .o-media-cell {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    max-width: 100%;
    min-width: 0;
  }

  .o-media-cell-thumbnail {
    flex-shrink: 0;
    width: 1.5rem;
    height: 1.5rem;
    object-fit: cover;
    background-color: hsl(var(--ohne-muted));
    border-radius: calc(var(--ohne-radius) - 0.25rem);
  }

  .o-media-cell-icon {
    flex-shrink: 0;
    font-size: 1.25rem;
  }
`;

/**
 * The cell display of an `image` or `file` field: a small thumbnail or the type's glyph, then the name.
 * The path shows in a tooltip; the short `UUID` stands in while the record loads.
 */
export function mediaDisplay(image: boolean): FieldType['display'] {
  return ({ value }) =>
    () => {
      const current = value();
      if (!isString(current) || current === '') return dimMark('-');
      return uploadCell(current, image);
    };
}

/**
 * The cell display of an `images` or `files` field: the first link's cell plus a dim `+n` tail.
 */
export function mediaListDisplay(image: boolean): FieldType['display'] {
  return ({ value }) =>
    () => {
      const current = value();
      const links = isArray(current) ? current.filter(isString) : [];
      const [first] = links;
      if (isUndefined(first)) return dimMark('-');
      return [uploadCell(first, image), links.length > 1 ? dimMark(` +${links.length - 1}`) : null];
    };
}

/**
 * One linked upload as a cell: its preview and name once the cache answers, a placeholder before.
 */
function uploadCell(uuid: string, image: boolean): HTMLElement {
  const t = useUploadsT();
  const root = h('span', { class: 'o-media-cell' }, () => {
    const record = mediaRecords.get(uuid);
    if (isUndefined(record)) {
      return h('span', { class: 'cell-mono cell-dim', title: uuid }, uuid.slice(0, 8));
    }
    if (isNull(record)) {
      return h('span', { class: 'cell-dim ohne-truncate' }, notFoundLabel(t, image, uuid));
    }
    return [preview(record), mediaFileName(record.name, { title: true })];
  });
  onCleanup(attachTooltip(root, () => mediaRecords.get(uuid)?.path ?? null));
  return root;
}

/**
 * The small preview of a record: its image when the browser renders it, else the type's glyph.
 */
function preview(record: UploadRecord): Node {
  if (isDisplayableImage(record)) {
    return h('img', {
      alt: record.description ?? '',
      src: previewURL(record),
      loading: 'lazy',
      class: 'o-media-cell-thumbnail',
    });
  }
  const glyph = icon(fileIcon(record));
  glyph.classList.add('o-media-cell-icon');
  return glyph;
}
