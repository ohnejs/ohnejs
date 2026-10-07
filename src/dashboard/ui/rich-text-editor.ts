import type { RecordLink } from '../../utils/rich-text/link.ts';
import type { RichText, RichTextMark, RichTextOptions } from '../../utils/rich-text/rich-text.ts';
import type { Child } from '../render/insert.ts';
import type { RichTextBlockType, RichTextState } from './rich-text-commands.ts';
import type { RichTextCommand, RichTextInputHost } from './rich-text-input.ts';
import type { Leaf, Selection } from './rich-text-model.ts';

import { isFunction } from '../../utils/is/is-function.ts';
import { isUndefined } from '../../utils/is/is-undefined.ts';
import { batchedEffect } from '../../utils/reactive/batched-effect.ts';
import { onCleanup } from '../../utils/reactive/effect-scope.ts';
import { ref } from '../../utils/reactive/ref.ts';
import { untracked } from '../../utils/reactive/untracked.ts';
import { RICH_TEXT_MARKS } from '../../utils/rich-text/rich-text.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import { createRichTextState } from './rich-text-commands.ts';
import { createRichTextView } from './rich-text-dom.ts';
import { bindRichTextInput, sliceRichText } from './rich-text-input.ts';
import {
  caret,
  clampPos,
  comparePos,
  isCollapsed,
  leafAt,
  leaves,
  linkRangeAt,
  marksAt,
} from './rich-text-model.ts';
import './tokens.ts';

/**
 * How the editor reaches link UI and record data it cannot import.
 */
export interface RichTextLinks<C extends string = string> {
  /**
   * Opens the link popup for the editor's selection.
   * Without it, `Mod-k` stays with the browser and the palette.
   */
  open?(editor: RichTextEditor<C>): void;

  /**
   * The address a record link opens, such as the record's dashboard path.
   */
  href?(link: RecordLink<C>): string | undefined;

  /**
   * The text a record link pasted at a caret inserts, such as the record's label.
   * Without it, or when it gives nothing, the pasted URL is inserted.
   */
  label?(link: RecordLink<C>): string | undefined;

  /**
   * Whether a record link's target is missing, which draws the link dashed.
   * A reactive read: links are redrawn when its answer changes.
   */
  missing?(link: RecordLink<C>): boolean;

  /**
   * Reads a dashboard record URL as the link to its record, for pasted links.
   */
  record?(url: string): RecordLink<C> | undefined;
}

/**
 * Options for `richTextEditor`.
 */
export interface RichTextEditorOptions<C extends string = string> {
  /**
   * The value the editor opens on.
   * A value without a leaf opens as one empty paragraph.
   */
  value: RichText<C>;

  /**
   * The field's options, which gate every command, key and paste.
   */
  options?: RichTextOptions;

  /**
   * Makes the editor read-only while it returns `true`.
   * The surface then has no `contenteditable` attribute, and links open natively.
   */
  disabled?: () => boolean;

  /**
   * Turns the frame destructive while it returns `true`.
   */
  error?: () => boolean;

  /**
   * The text the single empty leaf shows.
   * A getter reads reactively, so a translated placeholder resolves when its catalog lands.
   */
  placeholder?: string | (() => string);

  /**
   * The title a link to a missing record shows.
   * A getter reads reactively.
   */
  missingLabel?: string | (() => string);

  /**
   * The `id` of the surface.
   */
  id?: string;

  /**
   * The `spellcheck` attribute of the surface.
   *
   * @default
   * true
   */
  spellcheck?: boolean;

  /**
   * Content rendered inside the frame, before the surface, such as a toolbar.
   */
  prefix?: Child;

  /**
   * Content rendered inside the frame, after the surface, such as a counter.
   */
  suffix?: Child;

  /**
   * How the editor reaches link UI and record data.
   */
  links?: RichTextLinks<C>;

  /**
   * Moves focus into the toolbar on `Alt-F10`.
   * Without it, the key stays with the browser.
   */
  focusToolbar?(): void;

  /**
   * Called with the new document after every change the author makes.
   */
  onChange?(doc: RichText<C>): void;
}

/**
 * A live rich text editor.
 */
export interface RichTextEditor<C extends string = string> {
  /**
   * The frame, holding the prefix, the surface and the suffix.
   */
  element: HTMLElement;

  /**
   * The `contenteditable` surface, for `aria-*` wiring and focus checks.
   */
  surface: HTMLElement;

  /**
   * The editor's state. Reactive.
   */
  state(): RichTextState<C>;

  /**
   * The document, which always holds at least one leaf. Reactive.
   */
  doc(): RichText<C>;

  /**
   * Replaces the document without reporting a change, keeping the selection where it still fits.
   */
  setDoc(doc: RichText<C>): void;

  /**
   * Runs a command as a transaction, returning whether it applied.
   */
  run(command: RichTextCommand<C>): boolean;

  /**
   * Moves the selection, writing it to the DOM only while the surface has focus.
   */
  select(selection: Selection): void;

  /**
   * Focuses the surface and puts the selection back.
   * It uses `selection` when given, else the start of the first leaf with an error, else the last selection.
   */
  focus(selection?: Selection): void;

  /**
   * Marks the leaves at `paths` with an error rule, replacing earlier marks.
   * A mark stays on its leaf until the leaf is edited.
   */
  markErrors(paths: readonly (readonly number[])[]): void;

  /**
   * The marks a toolbar shows as pressed. Reactive.
   * On a caret, the stored marks or those at the caret, and on a range, those every selected character has.
   */
  activeMarks(): readonly RichTextMark[];

  /**
   * Whether any selected text has a mark, or the caret would type with one. Reactive.
   */
  marked(): boolean;

  /**
   * Whether the selection touches a link. Reactive.
   */
  linked(): boolean;

  /**
   * The type of the leaf the caret sits in, or the type of its list. Reactive.
   */
  blockType(): RichTextBlockType | 'ul' | 'ol';
}

css`
  .ohne-rich-text {
    --ohne-base-size: var(--ohne-size);
    display: flex;
    flex-direction: column;
    width: 100%;
    background-color: hsl(var(--ohne-card));
    border: 1px solid hsl(var(--ohne-input));
    border-radius: calc(var(--ohne-radius) - 0.125rem);
    font-size: calc(1rem + var(--ohne-size) * 0.125rem);
    transition: var(--ohne-transition);
    transition-property: border-color, box-shadow;
  }

  .ohne-rich-text:not(.ohne-rich-text-disabled):focus-within {
    border-color: transparent;
    box-shadow: 0 0 0 0.125rem hsl(var(--ohne-ring));
    outline: none;
  }

  .ohne-rich-text-has-errors {
    --ohne-ring: var(--ohne-destructive);
    border-color: hsl(var(--ohne-destructive));
  }

  .ohne-rich-text-disabled {
    --ohne-foreground: var(--ohne-muted-foreground);
    background-color: hsl(var(--ohne-muted));
    color: hsl(var(--ohne-muted-foreground));
  }

  .ohne-rich-text-surface {
    min-height: calc(2em + 0.125rem);
    padding: calc(0.5em - 0.15625rem) 0.5em;
    color: hsl(var(--ohne-foreground));
    white-space: pre-wrap;
    overflow-wrap: break-word;
    outline: none;
  }

  .ohne-rich-text-toolbar + .ohne-rich-text-surface {
    padding-block: 0.625rem;
  }

  .ohne-rich-text-surface a {
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }

  .ohne-rich-text-surface .ohne-rich-text-link-missing {
    text-decoration-style: dashed;
    text-decoration-color: hsl(var(--ohne-destructive));
  }

  .ohne-rich-text-surface :is([data-placeholder], .ohne-rich-text-leaf-error) {
    position: relative;
  }

  .ohne-rich-text-surface [data-placeholder]::before {
    content: attr(data-placeholder);
    position: absolute;
    pointer-events: none;
    color: hsl(var(--ohne-muted-foreground));
    font-weight: 400;
  }

  .ohne-rich-text-composing [data-placeholder]::before {
    content: none;
  }

  .ohne-rich-text-leaf-error::after {
    content: '';
    position: absolute;
    inset-block: 0;
    inset-inline-start: -0.375rem;
    width: 0.125rem;
    background-color: hsl(var(--ohne-destructive));
    pointer-events: none;
  }
`;

/**
 * A rich text editor: the document is the source of truth, and a `contenteditable` surface takes input.
 * Every edit runs as a transaction that renders the change and puts the selection back while focused.
 * Undo stays with the host form, and the selection survives blur, so `focus()` lands where the author was.
 * Keyboard and programmatic focus restore the last selection, and a pointer places its own caret.
 *
 * @example
 * ```ts
 * const editor = richTextEditor({
 *   value: [{ kind: 'paragraph', content: [{ text: 'Hello' }] }],
 *   options: { marks: ['strong', 'em'] },
 *   onChange: (doc) => console.log(doc),
 * })
 * editor.element // -> the frame to mount
 * ```
 */
export function richTextEditor<C extends string>(
  config: RichTextEditorOptions<C>,
): RichTextEditor<C> {
  const { options = {}, links = {} } = config;
  const disabled = config.disabled ?? (() => false);
  const current = ref(createRichTextState(config.value));
  const renders = ref(0);
  let errors = new Set<Leaf>();
  let stale = false;
  let pointing = false;

  const surface = h('div', {
    id: config.id,
    class: 'ohne-prose ohne-rich-text-surface',
    tabindex: '0',
    role: 'textbox',
    spellcheck: String(config.spellcheck ?? true),
    'aria-multiline': String(!options.inline || options.lineBreaks !== false),
    'aria-placeholder': () => textOf(config.placeholder) || undefined,
    'aria-readonly': () => disabled() && 'true',
    contenteditable: () => !disabled() && 'true',
  });

  const element = h(
    'div',
    {
      class: () =>
        'ohne-rich-text' +
        (config.error?.() ? ' ohne-rich-text-has-errors' : '') +
        (disabled() ? ' ohne-rich-text-disabled' : ''),
      onDblclick: (event: MouseEvent) => event.stopPropagation(),
    },
    config.prefix,
    surface,
    config.suffix,
  );

  const view = createRichTextView<C>(surface, {
    href: links.href,
    missing: links.missing,
    missingLabel: () => textOf(config.missingLabel),
  });

  const now = () => untracked(() => current.value);
  const focused = () => surface.ownerDocument.activeElement === surface;

  const clampSelection = (selection: Selection, doc: RichText<C>): Selection => ({
    anchor: clampPos(doc, selection.anchor),
    head: clampPos(doc, selection.head),
  });

  const draw = (typed?: Leaf<C>): void => {
    if (host.composing) {
      stale = true;
      return;
    }
    stale = false;
    const { doc, selection } = now();
    const placeholder = untracked(() => textOf(config.placeholder));
    untracked(() => view.render(doc, { typed, errors, placeholder }));
    if (focused()) view.writeSelection(selection);
    renders.value++;
  };

  const commit = (next: RichTextState<C>, typed?: Leaf<C>): void => {
    const changed = next.doc !== now().doc;
    current.value = next;
    if (changed || typed || stale) draw(typed);
    else if (focused() && !host.composing) view.writeSelection(next.selection);
    if (changed) config.onChange?.(next.doc);
  };

  const select = (selection: Selection): void => {
    const { doc } = now();
    current.value = { doc, selection: clampSelection(selection, doc) };
  };

  const read = (): RichTextState<C> => {
    const selection = host.composing ? undefined : view.readSelection();
    if (selection && !sameSelection(selection, now().selection)) select(selection);
    return now();
  };

  const selectedRuns = () => {
    const { doc, selection } = current.value;
    return leaves(sliceRichText(doc, selection)).flatMap((entry) => entry.leaf.content);
  };

  const editor: RichTextEditor<C> = {
    element,
    surface,
    state: () => current.value,
    doc: () => current.value.doc,

    setDoc(doc) {
      const { selection } = now();
      const next = createRichTextState(doc);
      current.value = { doc: next.doc, selection: clampSelection(selection, next.doc) };
      draw();
    },

    run: (command) => host.transact(command),

    select(selection) {
      select(selection);
      if (focused() && !host.composing) view.writeSelection(now().selection);
    },

    focus(selection) {
      const { doc } = now();
      const errored = leaves(doc).find((entry) => errors.has(entry.leaf));
      const target = selection ?? (errored && caret({ path: errored.path, offset: 0 }));
      if (target) select(target);
      surface.focus();
      view.writeSelection(now().selection);
    },

    markErrors(paths) {
      const { doc } = now();
      errors = new Set(paths.flatMap((path) => leafAt(doc, path) ?? []));
      draw();
    },

    activeMarks() {
      const { doc, selection, storedMarks } = current.value;
      if (isCollapsed(selection)) return storedMarks ?? marksAt(doc, selection.head);
      const runs = selectedRuns();
      return RICH_TEXT_MARKS.filter(
        (mark) => runs.length > 0 && runs.every((run) => run.marks?.includes(mark)),
      );
    },

    marked() {
      const { doc, selection, storedMarks } = current.value;
      if (!isCollapsed(selection)) return selectedRuns().some((run) => run.marks?.length);
      return (storedMarks ?? marksAt(doc, selection.head)).length > 0;
    },

    linked() {
      const { doc, selection } = current.value;
      if (isCollapsed(selection)) return !isUndefined(linkRangeAt(doc, selection.head));
      return selectedRuns().some((run) => run.link);
    },

    blockType() {
      const { doc, selection } = current.value;
      const [index = 0, ...rest] = selection.head.path;
      const block = doc[index];
      if (block?.kind === 'list') {
        let list = block;
        for (const item of rest.slice(0, -1)) list = list.items[item]?.list ?? list;
        return list.ordered ? 'ol' : 'ul';
      }
      if (block?.kind === 'heading') return `h${block.level}`;
      return block?.kind === 'quote' ? 'blockquote' : 'p';
    },
  };

  const host: RichTextInputHost<C> = {
    surface,
    view,
    options,
    composing: false,
    disabled,
    state: now,
    read,
    transact(command) {
      const next = command(read());
      if (!next) return false;
      commit(next);
      return true;
    },
    accept: commit,
    link() {
      if (!links.open || options.links === false) return false;
      links.open(editor);
      return true;
    },
    focusToolbar() {
      if (!config.focusToolbar) return false;
      config.focusToolbar();
      return true;
    },
    record: links.record,
    label: links.label,
  };

  bindRichTextInput(host);

  const onSelectionChange = (): void => {
    if (host.composing) return;
    const selection = view.readSelection();
    if (selection && !sameSelection(selection, now().selection)) {
      select(selection);
    }
  };
  surface.ownerDocument.addEventListener('selectionchange', onSelectionChange);
  onCleanup(() => surface.ownerDocument.removeEventListener('selectionchange', onSelectionChange));

  surface.addEventListener('pointerdown', () => {
    pointing = true;
    setTimeout(() => (pointing = false));
  });
  surface.addEventListener('focus', () => {
    if (!pointing) view.writeSelection(now().selection);
  });

  batchedEffect(() => {
    textOf(config.placeholder);
    untracked(() => draw());
  });

  batchedEffect(() => {
    void renders.value;
    view.decorateLinks();
  });

  return editor;
}

/**
 * Whether two selections have the same anchor and head.
 */
function sameSelection(a: Selection, b: Selection): boolean {
  return comparePos(a.anchor, b.anchor) === 0 && comparePos(a.head, b.head) === 0;
}

/**
 * Reads a static or reactive text option.
 */
function textOf(value: string | (() => string) | undefined): string {
  return (isFunction(value) ? value() : value) ?? '';
}
