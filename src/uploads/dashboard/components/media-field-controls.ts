import {
  attachTooltip,
  button,
  type Child,
  css,
  describeControl,
  type FieldFilter,
  type FieldFilterContext,
  type FieldType,
  h,
  icon,
  textInput,
  when,
} from 'ohnejs/dashboard';
import {
  isNull,
  isNullish,
  isString,
  isUndefined,
  onCleanup,
  type Ref,
  ref,
  untracked,
} from 'ohnejs/utils';

import type { UploadRecord } from '../../uploads/types.ts';
import type { DetailsTab } from './media-details-state.ts';

import {
  detailsHost,
  fileChip,
  hiddenFileInput,
  iconButton,
  ineligibility,
  noPermissionControl,
  notFoundLabel,
  pickerHost,
  uploadForField,
} from './_media-field-shared.ts';
import { mediaRecords } from './_media-records.ts';
import { useUploadsT } from './_messages.ts';
import { mediaFileItem } from './media-file-item.ts';
import { mediaFileName } from './media-file-name.ts';
import { mediaImageItem } from './media-image-item.ts';
import { uploadsCollection, uploadsPermissions } from './media-library-data.ts';
import { createPickerMemory, type MediaPickerMemory } from './media-library-popup.ts';
import { createMediaView, isDisplayableImage } from './media-library-state.ts';
import { acceptOf, constraintsOf } from './media-picker-validation.ts';

css`
  .o-media-field-preview {
    flex-shrink: 0;
    position: relative;
    width: 6.5rem;
    aspect-ratio: 1;
  }

  .o-media-field-preview-error {
    display: flex;
    width: 100%;
    aspect-ratio: 1;
    background-color: hsl(var(--ohne-background));
    border: 1px solid hsl(var(--ohne-border));
    border-radius: calc(var(--ohne-radius) - 0.125rem);
    font-size: 1.25rem;
    color: hsl(var(--ohne-muted-foreground));
  }

  .o-media-field-preview-error > * {
    margin: auto;
  }

  .o-media-field-details {
    min-width: 0;
    margin-top: auto;
  }

  .o-media-field-details > * + * {
    margin-top: 0.5rem;
  }

  .o-media-field-title {
    display: inline-block;
    max-width: 100%;
  }

  .o-media-field-description {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    max-width: 100%;
    margin-bottom: 0.375rem;
    font-size: 0.8125rem;
    color: hsl(var(--ohne-muted-foreground));
    text-decoration: none;
    transition: var(--ohne-transition);
    transition-property: box-shadow, color;
  }

  .o-media-field-description svg {
    flex-shrink: 0;
    display: none;
    font-size: 0.875rem;
  }

  button.o-media-field-description:hover,
  button.o-media-field-description:focus {
    color: hsl(var(--ohne-foreground));
  }

  button.o-media-field-description:hover svg,
  button.o-media-field-description:focus svg {
    display: inline-block;
  }
`;

/**
 * The form control of an `image` or `file` field.
 *
 * Empty, it offers a Select button opening the picker and, with upload permission, an Upload button.
 * A linked image shows its tile, the name with the path in a tooltip, the alt text, and Replace and Clear.
 * A linked file shows its name chip beside Replace and Clear.
 * The alt text row and the tile open the details popup; the tile's link opens the media page in a new tab.
 * A file deleted from the details popup clears the link.
 * An upload through the control lands in the root folder and applies once it passes the field's constraints.
 * The picker reopens where the viewer last browsed, starting in the linked file's folder.
 */
export function mediaControl(image: boolean): NonNullable<FieldType['control']> {
  return (context) => {
    const t = useUploadsT();
    if (isUndefined(uploadsCollection())) return noPermissionControl(context, t);
    const off = context.disabled === true;
    const { canUpload, canEdit } = uploadsPermissions();
    const constraints = constraintsOf(context.field.options);
    const disabled = ineligibility(constraints, image);
    const tileView = createMediaView();

    let base = context.initial;
    const model = ref<string | null>(isString(base) ? base : null);
    const touched = ref(false);
    const routed = ref('');
    const pickerOpen = ref(false);
    const details = ref<UploadRecord | null>(null);
    const detailsTab = ref<DetailsTab>('details');
    let memory: MediaPickerMemory | undefined;

    const baseUUID = (): string | null => (isString(base) ? base : null);
    const current = (): string | null => model.value;
    const record = (): UploadRecord | null | undefined => {
      const uuid = current();
      return isNull(uuid) ? null : mediaRecords.get(uuid);
    };
    const set = (next: string | null): void => {
      model.value = next;
      touched.value = true;
      routed.value = '';
      context.onInput();
    };
    const openPicker = (): void => {
      memory ??= createPickerMemory(untracked(record)?.directory);
      pickerOpen.value = true;
    };
    const openDetails = (linked: UploadRecord, tab: DetailsTab = 'details'): void => {
      detailsTab.value = tab;
      details.value = linked;
    };
    const describe = (el: HTMLElement): HTMLElement => {
      describeControl(el, context.field, context.path, () => routed.value);
      return el;
    };

    const input = hiddenFileInput({
      accept: acceptOf(constraints.types),
      onFiles: (files) =>
        void uploadForField(files.slice(0, 1), constraints, image).then(([uuid]) => {
          if (!isUndefined(uuid)) set(uuid);
        }),
    });

    const selectLabel = image ? 'uploads.dashboard.selectImage' : 'uploads.dashboard.selectFile';
    const empty = (): Child => [
      describe(
        button(
          h('span', { class: 'ohne-truncate' }, () => t(selectLabel)),
          {
            variant: 'outline',
            class: 'ohne-shrink',
            disabled: () => off,
            onClick: openPicker,
          },
        ),
      ),
      canUpload && !off
        ? iconButton(
            'upload',
            () => t('uploads.dashboard.upload'),
            (event) => {
              event.stopPropagation();
              input.click();
            },
          )
        : null,
    ];

    const actions = (): Child[] => [
      describe(
        iconButton(
          'replace',
          () => t('uploads.dashboard.replace'),
          openPicker,
          () => off,
        ),
      ),
      iconButton(
        'x',
        () => t('dashboard.clearSelection'),
        () => set(null),
        () => off,
      ),
    ];

    const descriptionRow = (linked: UploadRecord | null | undefined): HTMLElement => {
      const text = linked?.description || t('uploads.dashboard.noDescription');
      const inner = h(
        'span',
        { class: 'ohne-truncate', title: linked?.description ?? undefined },
        text,
      );
      if (!canEdit || isNullish(linked)) {
        return h('div', { class: 'o-media-field-description ohne-truncate' }, inner);
      }
      return h(
        'button',
        {
          type: 'button',
          class: 'o-media-field-description ohne-truncate ohne-raw',
          onClick: () => openDetails(linked, 'description'),
        },
        inner,
        icon('pencil'),
      );
    };

    const imagePreview = (): Child => [
      h('div', { class: 'o-media-field-preview o-media-item-box' }, () => {
        const linked = record();
        if (isUndefined(linked)) return null;
        if (isNull(linked))
          return h('div', { class: 'o-media-field-preview-error' }, icon('photo-off'));
        const tile = isDisplayableImage(linked) ? mediaImageItem : mediaFileItem;
        return tile(() => linked, {
          view: tileView,
          compact: true,
          onPick: () => openDetails(linked),
        });
      }),
      h(
        'div',
        { class: 'o-media-field-details' },
        () => {
          const linked = record();
          if (isUndefined(linked)) return null;
          if (isNull(linked)) {
            return h(
              'div',
              { class: 'ohne-muted' },
              h('span', { class: 'ohne-truncate' }, notFoundLabel(t, true, current() ?? '')),
            );
          }
          const title = h(
            'span',
            { class: 'o-media-field-title' },
            mediaFileName(linked.name, { title: true }),
          );
          onCleanup(attachTooltip(title, linked.path, { offset: 6 }));
          return h('div', null, title);
        },
        () => descriptionRow(record()),
        h('div', { class: 'ohne-row' }, actions()),
      ),
    ];

    const filled = (): Child =>
      image
        ? imagePreview()
        : [fileChip(record, () => current() ?? '', false, openDetails), ...actions()];

    const root = h(
      'div',
      { class: 'o-media-field ohne-row' },
      when(() => !isNull(current()), filled, empty),
      input,
      pickerHost(pickerOpen, () => {
        const uuid = current();
        return {
          values: isNull(uuid) ? [] : [uuid],
          disabled,
          memory,
          onApply: ([picked]) => {
            if (!isUndefined(picked)) set(picked);
          },
        };
      }),
      detailsHost(details, { tab: () => detailsTab.value, onDeleted: () => set(null) }),
    );

    return {
      element: root,
      read() {
        if (!touched.value && isUndefined(base)) return {};
        return { value: current() };
      },
      setErrors(errors) {
        routed.value = errors[''] ?? '';
        for (const [key, message] of Object.entries(errors)) {
          if (key !== '') return message;
        }
        return '';
      },
      error: () => routed.value,
      dirty: () => touched.value && current() !== baseUUID(),
      focus: () => root.querySelector<HTMLElement>('button, a')?.focus(),
      revert() {
        model.value = baseUUID();
        touched.value = false;
        routed.value = '';
      },
      rebase(value) {
        base = value;
        model.value = baseUUID();
        touched.value = false;
        routed.value = '';
      },
    };
  };
}

/**
 * The filter of an `image` or `file` field: identity through the picker, as the `record` filter compares.
 * A linked file shows its name chip beside Replace and Clear; empty, a Select button opens the picker.
 * A viewer who cannot read `Uploads` types the `UUID` into a mono input instead.
 */
export function mediaFilter(image: boolean): FieldFilter {
  return {
    operators: () => ['eq', 'ne'],
    seed: () => '',
    input(context) {
      const t = useUploadsT();
      if (isUndefined(uploadsCollection())) return fallbackInput(context);
      const disabled = ineligibility({}, image);
      const pickerOpen = ref(false);
      const details = ref<UploadRecord | null>(null);
      let memory: MediaPickerMemory | undefined;

      const current = (): string | null => {
        const value = context.value();
        return isString(value) && value !== '' ? value : null;
      };
      const record = (): UploadRecord | null | undefined => {
        const uuid = current();
        return isNull(uuid) ? null : mediaRecords.get(uuid);
      };
      const openPicker = (): void => {
        memory ??= createPickerMemory(untracked(record)?.directory);
        pickerOpen.value = true;
      };
      const openDetails = (linked: UploadRecord): void => {
        details.value = linked;
      };
      const identify = (el: HTMLElement): HTMLElement => {
        el.id = context.inputID;
        return el;
      };

      const selectLabel = image ? 'uploads.dashboard.selectImage' : 'uploads.dashboard.selectFile';
      return h(
        'div',
        { class: 'ohne-row' },
        when(
          () => !isNull(current()),
          () => [
            fileChip(record, () => current() ?? '', image, openDetails),
            identify(iconButton('replace', () => t('uploads.dashboard.replace'), openPicker)),
            iconButton(
              'x',
              () => t('dashboard.clearSelection'),
              () => context.commit(''),
            ),
          ],
          () =>
            identify(
              button(
                h('span', { class: 'ohne-truncate' }, () => t(selectLabel)),
                {
                  variant: 'outline',
                  class: 'ohne-shrink',
                  onClick: openPicker,
                },
              ),
            ),
        ),
        pickerHost(pickerOpen, () => {
          const uuid = current();
          return {
            values: isNull(uuid) ? [] : [uuid],
            disabled,
            memory,
            onApply: ([picked]) => context.commit(picked ?? ''),
          };
        }),
        detailsHost(details, { onDeleted: () => context.commit('') }),
      );
    },
  };
}

/**
 * The plain `UUID` input standing in when the viewer cannot browse `Uploads`.
 */
function fallbackInput(context: FieldFilterContext): HTMLElement {
  const bridged: Ref<string> = {
    get value() {
      return String(context.value());
    },
    set value(next) {
      context.set(next);
    },
  };
  const control = textInput(bridged, {
    id: context.inputID,
    name: context.inputID,
    onBlur: () => context.commit(),
  });
  control.classList.add('cell-mono');
  return control;
}
