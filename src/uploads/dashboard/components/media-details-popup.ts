import { loadPage } from 'app/components/collection-table-data.ts';
import { activeContentLocale } from 'app/components/content-language-switcher.ts';
import { historyButtons } from 'app/components/history-buttons.ts';
import { History, unsavedChanges } from 'app/components/history.ts';
import {
  api,
  apiUpload,
  attachTooltip,
  button,
  type ButtonOptions,
  type Child,
  createFieldForm,
  css,
  dashboardMeta,
  dropdown,
  dropdownItem,
  fallbackLabel,
  field,
  type FieldForm,
  fieldLabel,
  fieldMessage,
  formatDateTime,
  formatRelative,
  h,
  icon,
  type IconName,
  labelOf,
  numberInput,
  popup,
  type Popup,
  type PopupClose,
  type Props,
  renderProse,
  switchInput,
  tab,
  tabs,
  type TabsListItem,
  textInput,
  toast,
  useDashboardLanguage,
  useHotkeys,
  useRoute,
  when,
} from 'ohnejs/dashboard';
import {
  coerceToNumber,
  effect,
  first,
  formatBytes,
  formatDuration,
  hasKey,
  isEmpty,
  isNull,
  isNumber,
  isString,
  isUndefined,
  naturalCompare,
  onCleanup,
  parseDuration,
  parseSearchParams,
  ref,
  type Ref,
  sleep,
  stringifySearchParams,
  untracked,
} from 'ohnejs/utils';

import type { UploadRecord } from '../../uploads/types.ts';

import { copyText } from './_clipboard.ts';
import { useUploadsT } from './_messages.ts';
import { readWireError } from './_wire-error.ts';
import {
  type DetailsState,
  type DetailsTab,
  detailsPatch,
  detailsStateOf,
  focalPercent,
  focalPointAt,
  isSmallPreview,
  previewKindOf,
  variantTokens,
  versionedURL,
} from './media-details-state.ts';
import { mediaFileName } from './media-file-name.ts';
import {
  confirmDeleteUploads,
  refreshMedia,
  resolveUploadURL,
  temporaryLink,
  uploadsCollection,
  uploadsPermissions,
} from './media-library-data.ts';

/**
 * Options for `mediaDetailsPopup`.
 */
export interface MediaDetailsPopupOptions {
  /**
   * The tab the popup opens on.
   * `'variants'` falls back to details on a record carrying none.
   *
   * @default
   * 'details'
   */
  tab?: DetailsTab;

  /**
   * Called with the answered record after a save or a replaced file.
   */
  onUpdated?(record: UploadRecord): void;

  /**
   * Called with the record once the footer's Delete has removed it.
   */
  onDeleted?(record: UploadRecord): void;

  /**
   * Called when the popup asks to close, with its animated close function.
   * The caller awaits it and then disposes the region that created the popup.
   */
  onClose(close: PopupClose): void;
}

type WriteOutcome =
  | { kind: 'saved'; record: UploadRecord }
  | { kind: 'invalid'; errors: Readonly<Record<string, string>>; message: string }
  | { kind: 'gone' }
  | { kind: 'unreachable' }
  | { kind: 'writeFailed' };

const JSON_HEADERS = { 'content-type': 'application/json' };

const OCTET_STREAM = 'application/octet-stream';

const COPIED_FOR = 2000;

const COMPACT_FOOTER_WIDTH = 480;

const LINK_MAX_AGES = ['1h', '1d', '7d', '30d'];

const CHECKER_LIGHT =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAA5SURBVHgB7dGxEQAgDELRxDHYfzVYIzoChYXnQf3vNTTJKWMAnKxWXV7AgC+APWdOKMnJckrAP8ENTFgK0Z64q28AAAAASUVORK5CYII=';

const CHECKER_DARK =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAA/SURBVHgB7dOhEQAgDAPAwGFrmAEGYP+dMB0AVoio6PUSnXuTS1v7PBBxv0wNHcERKDADONgHmE2qp1EElgQ/ufgHd9nZw0oAAAAASUVORK5CYII=';

const detailsSignal = ref(0);

css`
  .o-media-details-fieldset {
    border: 0;
    margin: 0;
    padding: 0;
    min-inline-size: auto;
  }

  .o-media-details {
    display: flex;
    gap: 0.75rem;
  }

  .o-media-details-preview {
    flex: 1;
    width: 16rem;
  }

  .o-media-details-preview-centered {
    display: flex;
    justify-content: center;
    align-items: center;
  }

  .o-media-details-preview > * {
    margin: 0 auto;
    overflow: hidden;
    border: 1px solid hsl(var(--ohne-border));
    border-radius: calc(var(--ohne-radius) - 0.125rem);
  }

  .o-media-details-preview * {
    display: block;
  }

  .o-media-details-preview-image {
    display: flex;
    justify-content: center;
    align-items: center;
    background-image: url('${CHECKER_LIGHT}');
    background-color: hsl(var(--ohne-background));
    transition: var(--ohne-transition);
    transition-property: box-shadow;
  }

  .dark .o-media-details-preview-image {
    background-image: url('${CHECKER_DARK}');
  }

  .o-media-details-image-frame {
    position: relative;
    width: fit-content;
    max-width: 100%;
  }

  .o-media-details-focal-surface .o-media-details-image-frame {
    cursor: crosshair;
    touch-action: none;
    user-select: none;
  }

  .o-media-details-focal-marker {
    position: absolute;
    font-size: 1.5rem;
    line-height: 0;
    color: #fff;
    pointer-events: none;
    transform: translate(-50%, -50%);
    filter: drop-shadow(0 0 1px rgba(0, 0, 0, 0.9)) drop-shadow(0 0 3px rgba(0, 0, 0, 0.6));
  }

  .o-media-details-fields {
    flex-shrink: 0;
    width: 20rem;
  }

  .o-media-details-fields:only-child {
    width: 100%;
  }

  .o-media-details-fields .ohne-tabs-content:not(:first-child) {
    margin-top: 0.75rem;
  }

  .o-media-details-field a {
    text-decoration: none;
  }

  .o-media-details-field + .o-media-details-field,
  .ohne-field + .o-media-details-field {
    margin-top: 1rem;
  }

  .o-media-details-field .ohne-field-label {
    margin-bottom: 0.25em;
    color: hsl(var(--ohne-muted-foreground));
  }

  .o-media-details-url {
    --ohne-padding: 0.5rem;
    position: relative;
    margin-top: 0.5em;
  }

  .o-media-details-url-code {
    display: block;
    width: 100%;
    max-width: 100%;
    padding: calc(var(--ohne-padding) - 0.0625rem) var(--ohne-padding);
    overflow-x: auto;
    scrollbar-width: thin;
    scrollbar-color: hsl(var(--ohne-foreground) / 0.25) transparent;
    background-color: hsl(var(--ohne-card));
    border-width: 1px;
    border-radius: var(--ohne-radius);
    outline: none;
    font-family: var(--ohne-font-mono);
    font-size: calc((1rem + var(--ohne-size) * 0.125rem) - 0.0625rem);
    white-space: nowrap;
  }

  .o-media-details-url-copy {
    position: absolute;
    top: 0.5em;
    right: 0.5em;
    z-index: 1;
    display: none;
    min-width: 0;
    max-height: calc(100% - 1em);
    aspect-ratio: 1;
  }

  .o-media-details-url:hover .o-media-details-url-copy {
    --ohne-background: var(--ohne-card);
    display: inline-flex;
  }

  .o-media-details-variant {
    display: flex;
    gap: 0.625rem;
    align-items: center;
  }

  .o-media-details-variant + .o-media-details-variant,
  .o-media-details-variant + .ohne-field-message {
    margin-top: 0.75rem;
  }

  .o-media-details-variant-preview {
    display: flex;
    flex-shrink: 0;
    justify-content: center;
    align-items: center;
    width: 6rem;
    height: 6rem;
    overflow: hidden;
    border: 1px solid hsl(var(--ohne-border));
    border-radius: calc(var(--ohne-radius) - 0.125rem);
  }

  .o-media-details-variant-preview img {
    max-width: 100%;
    max-height: 100%;
  }

  .o-media-details-variant-missing {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    align-items: center;
    padding: 0.5rem;
    font-size: 0.75rem;
    line-height: 1rem;
    text-align: center;
    color: hsl(var(--ohne-muted-foreground));
  }

  .o-media-details-variant-info {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
    font-size: 0.8125rem;
  }

  .o-media-details-variant-info > * {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .o-media-details-variant-info strong {
    margin-bottom: 0.25rem;
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
  }

  .o-media-details-variant-info code {
    font-family: var(--ohne-font-mono);
    font-size: 0.875em;
  }

  .o-media-details-variant-copy {
    display: none;
  }

  .o-media-details-variant:hover .o-media-details-variant-copy {
    display: flex;
  }

  @media (max-width: 600px) {
    .o-media-details {
      flex-direction: column;
    }

    .o-media-details-preview,
    .o-media-details-fields {
      width: 100%;
    }
  }
`;

/**
 * Reads the `details` query parameter, reactively: the deep-linked file's `UUID`, or `undefined`.
 * Both `setDetailsQueryParam` writes and full navigations refresh the read.
 */
export function detailsQueryParam(): string | undefined {
  useRoute();
  void detailsSignal.value;
  const value = parseSearchParams(location.search).details;
  return isString(value) ? value : undefined;
}

/**
 * Writes the `details` query parameter into history, or removes it when `uuid` is `null`.
 * It deliberately bypasses the router: the popup opens over the LIVE page, and the grid is not rebuilt.
 * Removing an absent parameter is a no-op, so a stale close never pushes an entry.
 */
export function setDetailsQueryParam(uuid: string | null): void {
  const params = parseSearchParams(location.search);
  if (isNull(uuid) && isUndefined(params.details)) return;
  const query = stringifySearchParams({ ...params, details: uuid ?? undefined });
  history.pushState(
    null,
    '',
    location.pathname + (isEmpty(query) ? '' : `?${query}`) + location.hash,
  );
  detailsSignal.value += 1;
}

/**
 * Loads one upload by `UUID`, its `description` read at `locale`.
 * Resolves `null` when no such row exists and `undefined` when the read failed.
 */
export async function loadUpload(
  uuid: string,
  locale?: string,
): Promise<UploadRecord | null | undefined> {
  const body: Record<string, unknown> = { where: { UUID: uuid }, page: 1, perPage: 1 };
  if (!isUndefined(locale)) body.locale = locale;
  const page = await loadPage('uploads', body);
  if (isUndefined(page)) return undefined;
  const [first] = page.records;
  return isUndefined(first) ? null : (first as unknown as UploadRecord);
}

/**
 * The file details popup; the media page deep-links it by `?details=<uuid>`.
 *
 * A displayable image or a playable video previews on the left; the tabs sit beside it.
 * Details leads with the Private switch, then the upload time and author, the type, size, and dimensions.
 * It ends with the URL and a copy button.
 * Description edits the alt text at the content locale with undo and redo over a `History`.
 * Variants lists every named image variant with its tokens, byte size, rendered size, and a copy button.
 * That tab exists only while the record carries `variants`; on a private file it says when the links expire.
 * Pressing or dragging on an image preview places the focal point.
 * The point and the switch show in place and save with the description.
 * Cmd/Ctrl+S saves and closes; a `422` lands on the control and raises the tab's error bubble.
 * Closing is dirty-guarded through the `unsavedChanges` prompt.
 * The footer deletes after confirmation and replaces the file's bytes through a hidden file input.
 * On a private file it also copies a temporary link that anyone can open for a chosen duration.
 * Create it inside a reactive region; dispose the region after `onClose`'s close resolves.
 */
export function mediaDetailsPopup(record: UploadRecord, options: MediaDetailsPopupOptions): Popup {
  const t = useUploadsT();
  const language = useDashboardLanguage();
  const collection = uploadsCollection();
  const { canUpdate, canDelete } = uploadsPermissions();
  const preview = previewKindOf(record);
  const image = preview === 'image';
  const current = ref(record);
  const busy = ref(false);
  const requestedTab = options.tab ?? 'details';
  const activeTab = ref<DetailsTab>(
    requestedTab === 'variants' && isUndefined(record.variants) ? 'details' : requestedTab,
  );
  const unplaced = ref('');
  const seed = detailsStateOf(record);
  const focal = ref<Pick<DetailsState, 'focalX' | 'focalY'>>({
    focalX: seed.focalX,
    focalY: seed.focalY,
  });
  const priv = ref(seed.private);
  const edits = new History<DetailsState>().push(seed);
  const descriptionField = collection?.fields.find((entry) => entry.name === 'description');

  const buildForm = (state: DetailsState): FieldForm | undefined =>
    isUndefined(descriptionField)
      ? undefined
      : createFieldForm(
          [descriptionField],
          { description: state.description },
          {
            mode: 'edit',
            path: '',
            readOnly: !canUpdate,
            readOnlyRows: true,
            language: () => activeContentLocale() ?? language.value,
            onInput: () => {
              const state = currentState();
              if (!isUndefined(state)) void edits.pushDebounced(state);
            },
          },
        );
  const form = ref(buildForm(seed));
  onCleanup(() => form.value?.dispose());
  onCleanup(() => edits.clear());

  const currentState = (): DetailsState | undefined => {
    const reading = form.value?.read();
    if (!isUndefined(reading?.errors)) return undefined;
    const value = (reading?.value ?? {}) as Partial<DetailsState>;
    return {
      description: hasKey(value, 'description')
        ? (value.description ?? null)
        : current.value.description,
      ...focal.value,
      private: priv.value,
    };
  };

  const restore = (state: DetailsState): void => {
    form.value?.dispose();
    form.value = buildForm(state);
    focal.value = { focalX: state.focalX, focalY: state.focalY };
    priv.value = state.private;
  };

  const recordEdit = (): void => {
    const state = currentState();
    if (!isUndefined(state)) edits.push(state);
  };
  const setFocal = (focalX: number | null, focalY: number | null): void => {
    focal.value = { focalX, focalY };
    recordEdit();
  };
  const privateModel: Ref<boolean> = {
    get value() {
      return priv.value;
    },
    set value(next) {
      priv.value = next;
      recordEdit();
    },
  };

  const errored = (): boolean => (form.value?.errored() ?? false) || unplaced.value !== '';

  const save = async (): Promise<void> => {
    if (busy.value || !canUpdate) return;
    const reading = form.value?.read();
    if (!isUndefined(reading?.errors)) {
      form.value?.focusError();
      return;
    }
    const state = currentState();
    if (isUndefined(state)) return;
    busy.value = true;
    const outcome = await writeDetails(
      current.value.UUID,
      detailsPatch(state, image, detailsStateOf(current.value)),
      activeContentLocale(),
    );
    busy.value = false;
    if (outcome.kind === 'saved') {
      const next = detailsStateOf(outcome.record);
      current.value = outcome.record;
      form.value?.rebase({ description: next.description });
      focal.value = { focalX: next.focalX, focalY: next.focalY };
      priv.value = next.private;
      edits.push(next).setOriginalState(next);
      unplaced.value = '';
      refreshMedia();
      toast(t('dashboard.saved'), { type: 'success' });
      options.onUpdated?.(outcome.record);
      void close(true);
      return;
    }
    if (outcome.kind === 'invalid') {
      unplaced.value = isEmpty(outcome.errors)
        ? outcome.message
        : (form.value?.setErrors(outcome.errors) ?? outcome.message);
      toast(
        t('dashboard.foundErrors', { count: Math.max(1, Object.keys(outcome.errors).length) }),
        {
          type: 'error',
        },
      );
      return;
    }
    if (outcome.kind === 'gone') {
      toast(t('dashboard.record.gone'), { type: 'error' });
      void close(true);
      return;
    }
    toast(t(outcome.kind === 'unreachable' ? 'dashboard.unreachable' : 'dashboard.writeFailed'), {
      type: 'error',
    });
  };

  const remove = async (): Promise<void> => {
    if (busy.value) return;
    await confirmDeleteUploads([current.value]);
    const still = await loadUpload(current.value.UUID, activeContentLocale());
    if (isNull(still)) {
      options.onDeleted?.(current.value);
      void close(true);
    }
  };

  const fileInput = h('input', {
    hidden: true,
    type: 'file',
    accept: record.type ?? undefined,
    onChange: () => {
      const [file] = fileInput.files ?? [];
      fileInput.value = '';
      if (!isUndefined(file)) void replace(file);
    },
  }) as HTMLInputElement;

  const replace = async (file: File): Promise<void> => {
    busy.value = true;
    try {
      const response = await apiUpload(`POST /uploads/${current.value.UUID}/replace`, file, {
        headers: { 'content-type': file.type || OCTET_STREAM },
      });
      if (response.ok) {
        current.value = (await response.json()) as UploadRecord;
        refreshMedia();
        toast(t('uploads.dashboard.fileReplaced'), { type: 'success' });
        options.onUpdated?.(current.value);
      } else {
        toast((await readWireError(response)).message, { type: 'error' });
      }
    } catch {
      toast(t('dashboard.unreachable'), { type: 'error' });
    } finally {
      busy.value = false;
    }
  };

  const close = async (force = false): Promise<void> => {
    if (force || !edits.isDirty.value || ((await unsavedChanges.prompt?.()) ?? true)) {
      edits.clear();
      options.onClose(handle.close);
    }
  };

  const url = (): string => resolveUploadURL(current.value) ?? '';
  const src = (): string => versionedURL(url(), current.value._updatedAt);
  const hasFocal = (): boolean => !isNull(focal.value.focalX) && !isNull(focal.value.focalY);

  const imageFrame = (): HTMLElement => {
    const props: Props = { alt: () => current.value.description ?? '', src, draggable: 'false' };
    if (canUpdate) {
      const place = (event: PointerEvent): void => {
        focal.value = focalPointAt(event.offsetX, event.offsetY, img.clientWidth, img.clientHeight);
      };
      props.onPointerdown = (event: PointerEvent) => {
        if (event.button !== 0) return;
        img.setPointerCapture(event.pointerId);
        place(event);
      };
      props.onPointermove = (event: PointerEvent) => {
        if (img.hasPointerCapture(event.pointerId)) place(event);
      };
      props.onLostpointercapture = recordEdit;
    }
    const img = h('img', props);
    const marker = when(hasFocal, () =>
      h(
        'span',
        {
          class: 'o-media-details-focal-marker',
          style: () =>
            `left: ${focalPercent(focal.value.focalX ?? 0)}; top: ${focalPercent(focal.value.focalY ?? 0)}`,
        },
        icon('focus-2'),
      ),
    );
    return h('span', { class: 'o-media-details-image-frame' }, img, canUpdate ? marker : null);
  };

  const previewEl =
    preview === 'image'
      ? h(
          'div',
          {
            class: () =>
              'o-media-details-preview' +
              (isSmallPreview(current.value) ? ' o-media-details-preview-centered' : ''),
          },
          canUpdate
            ? h(
                'div',
                { class: 'o-media-details-preview-image o-media-details-focal-surface' },
                imageFrame(),
              )
            : h(
                'a',
                { href: url, target: '_blank', class: 'o-media-details-preview-image' },
                imageFrame(),
              ),
        )
      : preview === 'video'
        ? h(
            'div',
            { class: 'o-media-details-preview' },
            h('video', { src, controls: true, playsinline: true }),
          )
        : null;

  const labeled = (label: () => string, value: HTMLElement): HTMLElement =>
    h(
      'div',
      { class: 'o-media-details-field' },
      fieldLabel(h('span', { class: 'ohne-label' }, label)),
      value,
    );

  const row = (label: () => string, ...content: Child[]): HTMLElement =>
    labeled(label, h('div', { class: 'ohne-truncate' }, ...content));

  const wrappingRow = (label: () => string, ...content: Child[]): HTMLElement =>
    labeled(label, h('div', null, ...content));

  const authorRow = (): Child => {
    const author = record.author;
    if (isNull(author)) return null;
    const target = collection?.fields.find((entry) => entry.name === 'author')?.target ?? 'Users';
    const users = untracked(dashboardMeta)?.collections.find((entry) => entry.name === target);
    const label = (): string => labelOf(target, author) ?? fallbackLabel(author);
    const readable = !isUndefined(users) && users.operations.read?.allowed === true;
    return row(
      () => t('uploads.dashboard.uploadedBy'),
      readable
        ? h('a', { href: `/collections/${users.segment}/${author}`, target: '_blank' }, label)
        : label,
    );
  };

  const copyButton = (target: () => string, className?: string): HTMLElement => {
    const copied = ref(false);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const copy = button(() => icon(copied.value ? 'clipboard-check' : 'clipboard'), {
      size: -2,
      variant: 'outline',
      class: className,
      onClick: () =>
        void navigator.clipboard
          ?.writeText(target())
          .then(() => {
            copied.value = true;
            clearTimeout(timer);
            timer = setTimeout(() => {
              copied.value = false;
            }, COPIED_FOR);
          })
          .catch(() => undefined),
    });
    onCleanup(() => clearTimeout(timer));
    onCleanup(
      attachTooltip(
        copy,
        () => t(copied.value ? 'uploads.dashboard.copied' : 'uploads.dashboard.copyURL'),
        { hideOnClick: false },
      ),
    );
    return copy;
  };

  const urlRow = (): HTMLElement =>
    h(
      'div',
      { class: 'o-media-details-url' },
      h('code', { class: 'o-media-details-url-code', tabindex: '-1' }, url),
      copyButton(url, 'o-media-details-url-copy'),
    );

  const privateRow = (): HTMLElement =>
    field([
      fieldLabel(h('span', { class: 'ohne-label' }, () => t('uploads.dashboard.private'))),
      switchInput(privateModel, undefined, { disabled: () => !canUpdate || busy.value }),
      fieldMessage(() => t('uploads.dashboard.privateHint')),
    ]);

  const detailsPanel = (): Child => [
    privateRow(),
    wrappingRow(
      () => t('uploads.dashboard.uploadedOn'),
      () => formatDateTime(current.value.uploadedAt),
      ' ',
      h('span', { class: 'ohne-muted' }, () => `(${formatRelative(current.value.uploadedAt)})`),
    ),
    authorRow(),
    row(
      () => t('uploads.dashboard.fileType'),
      () => current.value.type ?? '',
    ),
    row(
      () => t('uploads.dashboard.fileSize'),
      () => formatBytes(current.value.size ?? 0),
      ' ',
      h(
        'span',
        { class: 'ohne-muted' },
        () => `(${t('uploads.dashboard.bytes', { count: current.value.size ?? 0 })})`,
      ),
    ),
    when(
      () => image && !isNull(current.value.width) && !isNull(current.value.height),
      () =>
        row(
          () => t('uploads.dashboard.dimensions'),
          () => `${current.value.width ?? 0} x ${current.value.height ?? 0}`,
          ' ',
          h('span', { class: 'ohne-muted' }, () => t('uploads.dashboard.pixels')),
        ),
    ),
    row(() => t('uploads.dashboard.fileURL'), urlRow()),
  ];

  const focalRow = (): HTMLElement => {
    const clear = button(icon('x'), {
      variant: 'outline',
      onClick: () => setFocal(null, null),
    });
    onCleanup(attachTooltip(clear, () => t('dashboard.clear')));
    const percentX = ref(0);
    const percentY = ref(0);
    effect(() => {
      percentX.value = Math.round((focal.value.focalX ?? 0) * 100);
      percentY.value = Math.round((focal.value.focalY ?? 0) * 100);
    });
    const axis = (model: Ref<number>): HTMLElement =>
      numberInput(model, {
        min: 0,
        max: 100,
        suffix: '%',
        autoWidth: true,
        disabled: () => !canUpdate,
        onCommit: () => setFocal(percentX.value / 100, percentY.value / 100),
      });
    const blank = (): HTMLElement =>
      textInput(ref(''), { placeholder: '-', autoWidth: true, disabled: () => true });
    const times = (): HTMLElement => h('span', { class: 'ohne-muted ohne-shrink-0' }, '×');
    return field([
      fieldLabel(h('span', { class: 'ohne-label' }, () => t('uploads.dashboard.focalPoint'))),
      h(
        'div',
        { class: 'o-media-details-focal ohne-row' },
        when(
          hasFocal,
          () => [axis(percentX), times(), axis(percentY)],
          () => [blank(), times(), blank()],
        ),
        when(
          () => canUpdate && hasFocal(),
          () => clear,
        ),
      ),
      canUpdate ? fieldMessage(() => t('uploads.dashboard.focalPointHint')) : null,
    ]);
  };

  const descriptionPanel = (): Child => [
    form.value?.render(),
    image ? focalRow() : null,
    when(
      () => unplaced.value !== '',
      () => fieldMessage(() => unplaced.value, { error: () => true }),
    ),
  ];

  const variantRow = (name: string, variantURL: string): HTMLElement => {
    const tokens = variantTokens(variantURL, current.value.path);
    const failed = ref(false);
    const loaded = ref(false);
    const bytes = ref(0);
    const img = h('img', {
      src: variantURL,
      alt: name,
      onLoad: () => {
        loaded.value = true;
      },
      onError: () => {
        failed.value = true;
      },
    }) as HTMLImageElement;
    void fetch(variantURL, { method: 'HEAD' })
      .then((response) => {
        const size = coerceToNumber(response.headers.get('content-length'));
        if (response.ok && isNumber(size) && size > 0) bytes.value = size;
      })
      .catch(() => undefined);
    return h(
      'div',
      { class: 'o-media-details-variant' },
      h(
        'a',
        {
          href: variantURL,
          target: '_blank',
          class: 'o-media-details-variant-preview o-media-details-preview-image ohne-raw',
        },
        when(
          () => failed.value,
          () =>
            h(
              'span',
              { class: 'o-media-details-variant-missing' },
              icon('photo-off'),
              h('span', null, () => t('uploads.dashboard.notRendered')),
            ),
          () => img,
        ),
      ),
      h(
        'div',
        { class: 'o-media-details-variant-info' },
        h('strong', null, name),
        h('code', { class: 'ohne-muted', title: tokens }, tokens),
        when(
          () => bytes.value > 0,
          () =>
            h(
              'span',
              null,
              () => formatBytes(bytes.value),
              ' ',
              h(
                'span',
                { class: 'ohne-muted' },
                () => `(${t('uploads.dashboard.bytes', { count: bytes.value })})`,
              ),
            ),
        ),
        when(
          () => loaded.value,
          () =>
            h(
              'span',
              null,
              () => `${img.naturalWidth} x ${img.naturalHeight}`,
              ' ',
              h('span', { class: 'ohne-muted' }, () => t('uploads.dashboard.pixels')),
            ),
        ),
      ),
      copyButton(() => variantURL, 'o-media-details-variant-copy'),
    );
  };

  const expiryNote = (): Child => {
    const { expires } = current.value;
    if (!current.value.private || isUndefined(expires)) return null;
    return fieldMessage(() => {
      const note = h('div');
      renderProse(note, t('uploads.dashboard.linksExpire', { when: formatRelative(expires) }));
      return note;
    });
  };

  const variantsPanel = (): Child => [
    ...Object.entries(current.value.variants ?? {})
      .sort(([a], [b]) => naturalCompare(a, b))
      .map(([name, variantURL]) => variantRow(name, variantURL)),
    expiryNote(),
  ];

  const detailsLabel = (): string => t('uploads.dashboard.details');
  const descriptionLabel = (): string => t('uploads.dashboard.description');
  const variantsLabel = (): string => t('uploads.dashboard.variants');
  const tabsEl = tabs<DetailsTab>(
    () => [
      tab('details', detailsPanel),
      tab('description', descriptionPanel),
      tab('variants', variantsPanel),
    ],
    {
      list: () => {
        const items: TabsListItem<DetailsTab>[] = [
          { name: 'details', label: detailsLabel },
          {
            name: 'description',
            label: descriptionLabel,
            bubble: errored()
              ? {
                  content: '1',
                  tooltip: t('dashboard.foundErrors', { count: 1 }),
                  variant: 'destructive',
                }
              : undefined,
          },
        ];
        if (!isUndefined(current.value.variants)) {
          items.push({ name: 'variants', label: variantsLabel });
        }
        return items;
      },
      active: () => activeTab.value,
      onChange: (next) => {
        activeTab.value = next;
      },
    },
  );

  const title = mediaFileName(() => current.value.name, { title: true });
  title.classList.add('ohne-medium');
  const headerClose = button(icon('x'), {
    size: -2,
    variant: 'ghost',
    class: 'ohne-ml-auto',
    onClick: () => void close(),
  });
  effect(() => {
    headerClose.title = t('dashboard.close');
  });

  const compact = ref(false);
  const glyphButton = (
    glyph: IconName,
    label: () => string,
    options: ButtonOptions,
  ): HTMLElement => {
    const el = button(icon(glyph), options);
    onCleanup(attachTooltip(el, label));
    return el;
  };
  const footerButton = (glyph: IconName, label: () => string, options: ButtonOptions): Child =>
    when(
      () => compact.value,
      () => glyphButton(glyph, label, options),
      () => button([h('span', null, label), icon(glyph)], options),
    );
  const deleteButton = footerButton('trash-x', () => t('dashboard.delete'), {
    variant: 'outline',
    destructiveHover: true,
    disabled: () => busy.value,
    onClick: () => void remove(),
  });
  const replaceButton = glyphButton('replace', () => t('uploads.dashboard.replaceFile'), {
    variant: 'outline',
    disabled: () => busy.value,
    onClick: () => fileInput.click(),
  });
  const linkAnchor = ref<HTMLElement | null>(null);
  const linkButton = (): Child =>
    glyphButton('link', () => t('uploads.dashboard.copyTemporaryLink'), {
      variant: 'outline',
      disabled: () => busy.value,
      onClick: (event) => {
        if (event.currentTarget instanceof HTMLElement) linkAnchor.value = event.currentTarget;
      },
    });
  const copyLink = async (maxAge: string): Promise<void> => {
    const link = temporaryLink(current.value.UUID, maxAge).then((url) => url ?? Promise.reject());
    const copied = await copyText(link);
    toast(t(copied ? 'uploads.dashboard.linkCopied' : 'uploads.dashboard.linkFailed'), {
      type: copied ? 'success' : 'error',
    });
  };
  const linkMenu = (): Child =>
    when(
      () => !isNull(linkAnchor.value),
      () => {
        const close = (): void => {
          linkAnchor.value = null;
        };
        const anchor = untracked(() => linkAnchor.value);
        anchor?.classList.replace('ohne-button-outline', 'ohne-button-primary');
        onCleanup(() => anchor?.classList.replace('ohne-button-primary', 'ohne-button-outline'));
        const panel = dropdown(
          LINK_MAX_AGES.map((maxAge) =>
            dropdownItem(
              h('span', null, () =>
                formatDuration(parseDuration(maxAge), { locale: language.value, style: 'long' }),
              ),
              {
                onClick: () => {
                  close();
                  void copyLink(maxAge);
                },
              },
            ),
          ),
          { reference: anchor ?? undefined, onClose: close },
        );
        return panel.root;
      },
    );
  const saveButton = button(() => t('dashboard.save'), {
    variant: 'primary',
    class: 'ohne-ml-auto',
    disabled: () => busy.value,
    onClick: () => void save(),
  });
  const closeButton = button(() => t('dashboard.close'), {
    variant: 'outline',
    class: 'ohne-ml-auto',
    onClick: () => void close(),
  });

  const hotkeys = canUpdate
    ? useHotkeys({
        allowInOverlays: true,
        allowWhileTyping: ['undo', 'redo'],
        target: () => handle.root,
        listen: false,
      })
    : undefined;
  const footerEl = h(
    'div',
    { class: 'ohne-row' },
    isUndefined(hotkeys) ? null : historyButtons(edits, restore, hotkeys),
    canDelete ? deleteButton : null,
    canUpdate ? [replaceButton, fileInput] : null,
    when(
      () => current.value.private && !isUndefined(current.value.expires),
      () => [linkButton(), linkMenu()],
    ),
    when(
      () => edits.isDirty.value,
      () => saveButton,
      () => closeButton,
    ),
  );
  const footerSize = new ResizeObserver((entries) => {
    compact.value = (first(entries)?.contentRect.width ?? Infinity) < COMPACT_FOOTER_WIDTH;
  });
  footerSize.observe(footerEl);
  onCleanup(() => footerSize.disconnect());

  const handle = popup(
    h(
      'fieldset',
      { class: 'o-media-details-fieldset', disabled: () => busy.value },
      h(
        'div',
        { class: 'o-media-details' },
        previewEl,
        h('div', { class: 'o-media-details-fields' }, tabsEl),
      ),
    ),
    {
      size: -1,
      width: isNull(preview) ? '32rem' : '64rem',
      fullHeight: 'auto',
      header: h('div', { class: 'ohne-row' }, title, headerClose),
      footer: footerEl,
      onClose: () => void close(),
    },
  );

  if (!isUndefined(hotkeys)) {
    setTimeout(() => {
      hotkeys.isListening.value = true;
      hotkeys.listen('save', (event) => {
        event.preventDefault();
        const active = document.activeElement;
        if (active instanceof HTMLElement) active.blur();
        setTimeout(() => void save());
      });
    });
  }

  return handle;
}

/**
 * Sends the details `PATCH`, retrying once on a busy `503`, exactly as a collection's field write.
 * A given `locale` rides the URL, so the description lands at that content locale.
 */
async function writeDetails(
  uuid: string,
  body: Record<string, unknown>,
  locale?: string,
): Promise<WriteOutcome> {
  const suffix = isUndefined(locale) ? '' : `?${stringifySearchParams({ locale })}`;
  const send = (): Promise<Response> =>
    api(`PATCH /uploads/${uuid}${suffix}`, { headers: JSON_HEADERS, body: JSON.stringify(body) });
  try {
    let response = await send();
    if (response.status === 503) {
      await sleep(1000);
      response = await send();
    }
    if (response.ok) return { kind: 'saved', record: (await response.json()) as UploadRecord };
    if (response.status === 422) {
      const { errors, message } = await readWireError(response);
      return { kind: 'invalid', errors, message };
    }
    if (response.status === 404) return { kind: 'gone' };
    return { kind: 'writeFailed' };
  } catch {
    return { kind: 'unreachable' };
  }
}
