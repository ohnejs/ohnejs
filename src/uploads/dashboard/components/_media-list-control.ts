import { loadPage } from 'app/components/collection-table-data.ts';
import {
  attachTooltip,
  css,
  describeControl,
  type DynamicChipsChoice,
  type DynamicChipsPaginatedChoices,
  dynamicChips,
  fallbackLabel,
  type FieldType,
  h,
  icon,
  type Primitive,
} from 'ohnejs/dashboard';
import {
  deepEqual,
  effect,
  isArray,
  isEmpty,
  isNull,
  isNullish,
  isNumber,
  isString,
  isUndefined,
  onCleanup,
  ref,
  untracked,
} from 'ohnejs/utils';

import type { UploadRecord } from '../../uploads/types.ts';

import {
  detailsHost,
  hiddenFileInput,
  iconButton,
  ineligibility,
  isPlainClick,
  noPermissionControl,
  notFoundLabel,
  pickerHost,
  uploadForField,
} from './_media-field-shared.ts';
import { mediaRecords } from './_media-records.ts';
import { useUploadsT } from './_messages.ts';
import { fileIcon, mediaFileItem } from './media-file-item.ts';
import { mediaFileName } from './media-file-name.ts';
import { detailsHref, mediaImageItem } from './media-image-item.ts';
import { previewURL, uploadsCollection, uploadsPermissions } from './media-library-data.ts';
import { createPickerMemory, type MediaPickerMemory } from './media-library-popup.ts';
import {
  createMediaView,
  isDisplayableImage,
  PER_PAGE,
  searchWhere,
} from './media-library-state.ts';
import { acceptOf, constraintsOf, constraintWhere } from './media-picker-validation.ts';

css`
  .o-media-chips-field {
    align-items: flex-start;
  }

  .o-media-chips-label {
    margin-top: 0;
  }

  .o-media-chips-preview {
    flex-shrink: 0;
    position: relative;
    width: 6.5rem;
    aspect-ratio: 1;
    pointer-events: none;
  }

  .o-media-chips-preview-error {
    display: flex;
    width: 100%;
    aspect-ratio: 1;
    background-color: hsl(var(--ohne-background));
    border: 1px solid hsl(var(--ohne-border));
    border-radius: calc(var(--ohne-radius) - 0.25rem);
    font-size: 1.25rem;
    color: hsl(var(--ohne-muted-foreground));
  }

  .o-media-chips-preview-error > * {
    margin: auto;
  }

  .o-media-chips-field .ohne-dynamic-chips-label .ohne-muted {
    color: currentColor;
    opacity: 0.64;
  }

  .o-media-chips-field .ohne-dynamic-chips-dragging .ohne-dynamic-chips-label {
    pointer-events: none;
  }

  .o-media-chips-field-image .ohne-dynamic-chips-item {
    --ohne-background: transparent;
    position: relative;
    height: auto;
    padding: 0;
  }

  .o-media-chips-field-image .ohne-dynamic-chips-item-destructive {
    --ohne-border: var(--ohne-destructive);
  }

  .o-media-chips-field-image .ohne-dynamic-chips-remove {
    position: absolute;
    display: none;
    justify-content: center;
    align-items: center;
    top: 0.375rem;
    right: 0.375rem;
    width: 1.125rem;
    height: 1.125rem;
    background-color: hsl(var(--ohne-accent));
    border-radius: calc(var(--ohne-radius) - 0.25rem);
    color: hsl(var(--ohne-accent-foreground));
    transition: var(--ohne-transition);
    transition-property: background-color, color;
  }

  .o-media-chips-field-image
    .ohne-dynamic-chips:not(.ohne-dynamic-chips-dragging)
    .ohne-dynamic-chips-item:hover
    .ohne-dynamic-chips-remove,
  .o-media-chips-field-image
    .ohne-dynamic-chips:not(.ohne-dynamic-chips-dragging)
    .ohne-dynamic-chips-item:focus
    .ohne-dynamic-chips-remove {
    display: flex;
  }

  .o-media-chips-field-image .ohne-dynamic-chips-remove:hover,
  .o-media-chips-field-image .ohne-dynamic-chips-remove:focus {
    background-color: hsl(var(--ohne-destructive));
    color: hsl(var(--ohne-destructive-foreground));
  }

  .o-media-chips-field-image .ohne-dynamic-chips-input {
    height: auto;
    min-height: calc(2em - 0.125rem);
  }

  .o-media-chips-field-image .ohne-dynamic-chips-dropzone {
    height: auto;
  }

  .o-media-chips-field-image .o-media-image-item-button,
  .o-media-chips-field-image .o-media-file-item-button {
    border-radius: calc(var(--ohne-radius) - 0.25rem);
  }

  .o-media-chips-field-image .ohne-dynamic-chips-item:hover .o-media-image-dimensions,
  .o-media-chips-field-image .ohne-dynamic-chips-item:hover .o-media-image-size,
  .o-media-chips-field-image .ohne-dynamic-chips-item:hover .o-media-file-size,
  .o-media-chips-field-image .ohne-dynamic-chips-item:focus .o-media-image-dimensions,
  .o-media-chips-field-image .ohne-dynamic-chips-item:focus .o-media-image-size,
  .o-media-chips-field-image .ohne-dynamic-chips-item:focus .o-media-file-size,
  .o-media-chips-field-image .ohne-dynamic-chips-dragging .o-media-image-dimensions,
  .o-media-chips-field-image .ohne-dynamic-chips-dragging .o-media-image-size,
  .o-media-chips-field-image .ohne-dynamic-chips-dragging .o-media-file-size {
    display: none;
  }

  .o-media-chips-field-image .ohne-dynamic-chips-dropdown-item {
    flex-direction: row;
    justify-content: flex-start;
  }

  .o-media-chips-choice {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .o-media-chips-choice-preview {
    flex-shrink: 0;
    height: calc(100% - 0.5rem);
    aspect-ratio: 1;
    object-fit: contain;
  }

  .o-media-chips-choice-text {
    display: flex;
    flex-direction: column;
  }
`;

/**
 * The form control of an `images` or `files` field.
 *
 * An orderable chips field over `Uploads`: image chips show their tile, file chips their name.
 * The dropdown searches file names across every folder, newest first, within the constraints it can express.
 * A leading library button opens the picker in multiple mode; create permission adds an Upload button.
 * A double-click on a chip opens the file's details; a modified one opens the media page in a new tab.
 * A file deleted from the details popup leaves the list.
 * Server messages keyed by index mark their chips destructive.
 */
export function mediaListControl(image: boolean): NonNullable<FieldType['control']> {
  return (context) => {
    const t = useUploadsT();
    if (isUndefined(uploadsCollection())) return noPermissionControl(context, t);
    const off = context.disabled === true;
    const { canCreate } = uploadsPermissions();
    const constraints = constraintsOf(context.field.options);
    const disabled = ineligibility(constraints, image);
    const max = context.field.options?.max;
    const tileView = createMediaView();
    const pickerOpen = ref(false);
    const details = ref<UploadRecord | null>(null);
    let memory: MediaPickerMemory | undefined;

    let base = listOf(context.initial);
    const model = ref<Primitive[]>([...base]);
    const touched = ref(false);
    const routed = ref('');
    const erroredIndices = ref<number[]>([]);

    // The chips write the model directly; this effect relays edits; `silent` mutes the first run and resets.
    let silent = true;
    effect(() => {
      void model.value;
      if (silent) return;
      untracked(() => {
        touched.value = true;
        routed.value = '';
        erroredIndices.value = [];
        context.onInput();
      });
    });
    silent = false;

    const reset = (next: readonly string[]): void => {
      silent = true;
      model.value = [...next];
      silent = false;
      touched.value = false;
      routed.value = '';
      erroredIndices.value = [];
    };

    const uuids = (): string[] => model.value.filter(isString);

    const firstDirectory = (): string | undefined => {
      for (const uuid of uuids()) {
        const record = mediaRecords.get(uuid);
        if (!isNullish(record)) return record.directory;
      }
      return undefined;
    };

    const openPicker = (): void => {
      memory ??= createPickerMemory(untracked(firstDirectory));
      pickerOpen.value = true;
    };

    const choicesResolver = async (
      page: number,
      keyword: string,
    ): Promise<DynamicChipsPaginatedChoices> => {
      const constraint = constraintWhere(constraints, image);
      const search = searchWhere(keyword);
      const loaded = await loadPage('uploads', {
        where: isUndefined(search) ? constraint : { and: [constraint, search] },
        order: ['-uploadedAt'],
        page,
        perPage: PER_PAGE,
      });
      if (isUndefined(loaded)) {
        return { choices: [], currentPage: 1, lastPage: 1, perPage: PER_PAGE, total: 0 };
      }
      const records = loaded.records as unknown as UploadRecord[];
      for (const record of records) mediaRecords.seed(record);
      return {
        choices: records.map((record) => ({
          value: record.UUID,
          label: record.name,
          detail: record.path,
          tooltip: record.path,
        })),
        currentPage: loaded.page,
        lastPage: loaded.lastPage,
        perPage: loaded.perPage,
        total: loaded.total,
      };
    };

    const selectedChoicesResolver = async (values: Primitive[]): Promise<DynamicChipsChoice[]> => {
      const ids = values.map(String);
      const records = await mediaRecords.load(ids);
      return ids.map((uuid, index) => {
        const record = records[index];
        if (isUndefined(record)) return { value: uuid, label: fallbackLabel(uuid) };
        if (isNull(record)) return { value: uuid, label: notFoundLabel(t, image, uuid) };
        return { value: uuid, label: record.name, tooltip: record.path };
      });
    };

    const imageLabel = (choice: DynamicChipsChoice): HTMLElement => {
      const uuid = String(choice.value);
      const el = h(
        'div',
        { class: 'ohne-dynamic-chips-label o-media-chips-label', title: choice.label ?? uuid },
        h('div', { class: 'o-media-chips-preview o-media-item-box' }, () => {
          const record = mediaRecords.get(uuid);
          if (isUndefined(record)) return null;
          if (isNull(record)) {
            return h(
              'div',
              { class: 'o-media-chips-preview-error', title: notFoundLabel(t, image, uuid) },
              icon('photo-off'),
            );
          }
          const tile = isDisplayableImage(record) ? mediaImageItem : mediaFileItem;
          return tile(() => record, { view: tileView, compact: true });
        }),
      );
      onCleanup(attachTooltip(el, () => choice.tooltip ?? null));
      return el;
    };

    const fileLabel = (choice: DynamicChipsChoice): HTMLElement => {
      const el = mediaFileName((choice.label ?? String(choice.value)) || '-', { title: true });
      el.classList.add('ohne-dynamic-chips-label');
      onCleanup(attachTooltip(el, () => choice.tooltip ?? null));
      return el;
    };

    const imageChoice = (choice: DynamicChipsChoice): HTMLElement => {
      const record = untracked(() => mediaRecords.get(String(choice.value)));
      return h(
        'span',
        { class: 'o-media-chips-choice' },
        isNullish(record) ? null : choicePreview(record),
        h(
          'span',
          { class: 'o-media-chips-choice-text' },
          h(
            'span',
            { class: 'ohne-dynamic-chips-dropdown-item-label' },
            String((choice.label ?? choice.value) || '-'),
          ),
          isUndefined(choice.detail)
            ? null
            : h('span', { class: 'ohne-dynamic-chips-dropdown-item-detail' }, choice.detail || '-'),
        ),
      );
    };

    const chips = dynamicChips(model, {
      disabled: () => off,
      choicesResolver,
      selectedChoicesResolver,
      error: () => routed.value !== '',
      erroredItems: () => erroredIndices.value,
      maxItems: isNumber(max) ? max : false,
      name: context.path,
      placeholder: context.field.placeholder,
      noResultsLabel: untracked(() => t('dashboard.noResultsFound')),
      removeItemLabel: untracked(() => t('dashboard.removeItem')),
      onDblclick: (value, event) => {
        const record = untracked(() => mediaRecords.get(String(value)));
        if (isNullish(record)) return;
        if (isPlainClick(event)) details.value = record;
        else window.open(detailsHref(record, true), '_blank');
      },
      label: ({ choice }) => (image ? imageLabel(choice) : fileLabel(choice)),
      choice: image ? ({ choice }) => imageChoice(choice) : undefined,
    });
    const input = chips.querySelector<HTMLInputElement>('.ohne-dynamic-chips-input');
    if (!isNull(input)) describeControl(input, context.field, context.path, () => routed.value);

    const fileInput = hiddenFileInput({
      accept: acceptOf(constraints.types),
      multiple: true,
      onFiles: (files) =>
        void uploadForField(files, constraints, image).then((picked) => {
          if (picked.length > 0) model.value = [...model.value, ...picked];
        }),
    });

    const element = h(
      'div',
      { class: 'o-media-chips-field ohne-row' + (image ? ' o-media-chips-field-image' : '') },
      iconButton(
        'library-photo',
        () => t('uploads.dashboard.mediaLibrary'),
        openPicker,
        () => off,
      ),
      chips,
      canCreate && !off
        ? iconButton(
            'upload',
            () => t('uploads.dashboard.upload'),
            (event) => {
              event.stopPropagation();
              fileInput.click();
            },
          )
        : null,
      fileInput,
      pickerHost(pickerOpen, () => ({
        values: uuids(),
        multiple: true,
        disabled,
        memory,
        onApply: (picked) => {
          model.value = [...picked];
        },
      })),
      detailsHost(details, {
        onDeleted: (record) => {
          model.value = model.value.filter((value) => value !== record.UUID);
        },
      }),
    );

    return {
      element,
      read() {
        if (!touched.value && isUndefined(context.initial)) return {};
        return { value: model.value };
      },
      setErrors(errors) {
        routed.value = errors[''] ?? '';
        const marked: number[] = [];
        let unplaced = '';
        for (const [key, message] of Object.entries(errors)) {
          if (key === '') continue;
          const match = /^\[(\d+)\]$/.exec(key);
          if (isNull(match)) {
            if (unplaced === '') unplaced = message;
          } else {
            marked.push(Number(match[1]));
          }
        }
        erroredIndices.value = marked;
        return unplaced;
      },
      error: () => routed.value,
      errored: () => !isEmpty(erroredIndices.value),
      dirty: () => touched.value && !deepEqual(model.value, base),
      focus: () => input?.focus(),
      revert() {
        reset(base);
      },
      rebase(value) {
        base = listOf(value);
        reset(base);
      },
    };
  };
}

/**
 * The dropdown row's preview: the image itself when the browser renders it, else the type's glyph.
 */
function choicePreview(record: UploadRecord): Node {
  if (isDisplayableImage(record)) {
    return h('img', { alt: '', src: previewURL(record), class: 'o-media-chips-choice-preview' });
  }
  const glyph = icon(fileIcon(record));
  glyph.classList.add('o-media-chips-choice-preview');
  return glyph;
}

/**
 * The stored value as a `UUID` list, malformed entries dropped.
 */
function listOf(value: unknown): readonly string[] {
  return isArray(value) ? value.filter(isString) : [];
}
