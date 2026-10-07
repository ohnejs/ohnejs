import type { IconName } from '../../utils/icon/icon-name.ts';
import type {
  RichTextHeadingLevel,
  RichTextMark,
  RichTextOptions,
} from '../../utils/rich-text/rich-text.ts';
import type { RichTextBlockType } from './rich-text-commands.ts';
import type { RichTextEditor } from './rich-text-editor.ts';
import type { RichTextCommand } from './rich-text-input.ts';

import { first } from '../../utils/array/first.ts';
import { last } from '../../utils/array/last.ts';
import { next } from '../../utils/array/next.ts';
import { prev } from '../../utils/array/prev.ts';
import { debounce } from '../../utils/debounce/debounce.ts';
import { ariaKeyShortcut } from '../../utils/keys/aria-key-shortcut.ts';
import { keySpecLabel } from '../../utils/keys/key-spec-label.ts';
import { batchedEffect } from '../../utils/reactive/batched-effect.ts';
import { computed } from '../../utils/reactive/computed.ts';
import { onCleanup } from '../../utils/reactive/effect-scope.ts';
import { effect } from '../../utils/reactive/effect.ts';
import { ref } from '../../utils/reactive/ref.ts';
import { untracked } from '../../utils/reactive/untracked.ts';
import {
  RICH_TEXT_DEFAULT_ELEMENTS,
  RICH_TEXT_DEFAULT_MARKS,
  RICH_TEXT_MARKS,
} from '../../utils/rich-text/rich-text.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import { when } from '../render/when.ts';
import { dropdownItem } from './dropdown-item.ts';
import { dropdown } from './dropdown.ts';
import { placeFloating } from './floater-place.ts';
import { icon } from './icon.ts';
import { placeFixed, raiseToTopLayer } from './overlay.ts';
import { clearMarks, setBlockType, toggleList, toggleMark } from './rich-text-commands.ts';
import { RICH_TEXT_KEYS } from './rich-text-keys.ts';
import { isCollapsed } from './rich-text-model.ts';
import { attachTooltip } from './tooltip.ts';
import './tokens.ts';

/**
 * The text a rich text toolbar shows, translated by its host.
 */
export interface RichTextToolbarLabels {
  /**
   * The toolbar's accessible name.
   */
  toolbar: string;

  /**
   * The tooltip of the block-type dropdown.
   */
  blockType: string;

  /**
   * The paragraph block type.
   */
  paragraph: string;

  /**
   * A heading block type of the given level.
   */
  heading(level: RichTextHeadingLevel): string;

  /**
   * The bulleted list block type.
   */
  bulletList: string;

  /**
   * The numbered list block type.
   */
  orderedList: string;

  /**
   * The quote block type.
   */
  quote: string;

  /**
   * The bold button.
   */
  strong: string;

  /**
   * The italic button.
   */
  em: string;

  /**
   * The strikethrough button.
   */
  del: string;

  /**
   * The code button.
   */
  code: string;

  /**
   * The link button.
   */
  link: string;

  /**
   * The clear formatting button.
   */
  clearFormatting: string;
}

/**
 * Options for `richTextToolbar`.
 */
export interface RichTextToolbarOptions {
  /**
   * The field's options, which pick the toolbar and its buttons.
   * An `inline` value gets a bubble toolbar, and any other value a fixed one.
   */
  options?: RichTextOptions;

  /**
   * The toolbar's text. Reactive.
   */
  labels: () => RichTextToolbarLabels;

  /**
   * Disables every button while it returns `true`.
   */
  disabled?: () => boolean;

  /**
   * Opens the link popup for the editor's selection.
   * Without it, or with `links: false`, there is no link button.
   */
  onLink?(): void;
}

/**
 * A live rich text toolbar.
 */
export interface RichTextToolbar {
  /**
   * The toolbar, which goes first in the editor's frame.
   * A bubble toolbar floats in the top layer from there, so the frame still holds its focus.
   */
  element: HTMLElement;

  /**
   * Moves focus into the toolbar, onto the button focused last, and shows a bubble toolbar at once.
   */
  focus(): void;
}

type BlockKind = RichTextBlockType | 'ul' | 'ol';

const BLOCK_ICONS: Record<BlockKind, IconName> = {
  p: 'pilcrow',
  h2: 'h-2',
  h3: 'h-3',
  h4: 'h-4',
  h5: 'h-5',
  h6: 'h-6',
  ul: 'list',
  ol: 'list-numbers',
  blockquote: 'quote',
};

const BLOCK_KINDS = Object.keys(BLOCK_ICONS) as BlockKind[];

const MARK_ICONS: Record<RichTextMark, IconName> = {
  strong: 'bold',
  em: 'italic',
  del: 'strikethrough',
  code: 'code',
};

type Move = (current: HTMLElement, tools: HTMLElement[]) => HTMLElement | undefined;

const MOVES = new Map<string, Move>([
  ['ArrowRight', (current, tools) => next(current, tools, { loop: true })],
  ['ArrowLeft', (current, tools) => prev(current, tools, { loop: true })],
  ['Home', (_, tools) => first(tools)],
  ['End', (_, tools) => last(tools)],
]);

const TOOL = '.ohne-rich-text-tool:enabled';
const SETTLE_MS = 150;
const BUBBLE_GAP = 8;

css`
  .ohne-rich-text-toolbar {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.125rem;
    padding: 0.25rem;
    background-color: hsl(var(--ohne-card));
    border-bottom: 1px solid hsl(var(--ohne-border));
    border-top-left-radius: calc(var(--ohne-radius) - 0.1875rem);
    border-top-right-radius: calc(var(--ohne-radius) - 0.1875rem);
  }

  .ohne-rich-text-disabled > .ohne-rich-text-toolbar {
    background-color: hsl(var(--ohne-muted));
  }

  .ohne-rich-text-bubble:popover-open {
    display: flex;
    align-items: center;
    gap: 0.125rem;
    padding: 0.25rem;
    background-color: hsl(var(--ohne-card));
    border: 1px solid hsl(var(--ohne-border));
    border-radius: calc(var(--ohne-radius) - 0.125rem);
    box-shadow: var(--ohne-shadow);
    color: hsl(var(--ohne-foreground));
  }

  .ohne-rich-text-separator {
    width: 1px;
    height: 1rem;
    margin: 0 0.25rem;
    background-color: hsl(var(--ohne-border));
  }

  .ohne-rich-text-tool {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.25rem;
    height: 1.625rem;
    min-width: 1.625rem;
    padding: 0 0.25rem;
    border-radius: 0.25rem;
    color: hsl(var(--ohne-foreground));
    font-size: 0.8125rem;
    line-height: 1;
    outline: none;
    transition: var(--ohne-transition);
    transition-property: background-color, color, box-shadow;
  }

  .ohne-rich-text-tool:hover:not(:disabled, [aria-pressed='true']),
  .ohne-rich-text-tool:is([aria-pressed='true'], [aria-expanded='true']) {
    background-color: hsl(var(--ohne-accent));
    color: hsl(var(--ohne-accent-foreground));
  }

  .ohne-rich-text-tool:focus-visible {
    box-shadow: 0 0 0 0.125rem hsl(var(--ohne-ring));
  }

  .ohne-rich-text-tool:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .ohne-rich-text-tool > svg {
    width: 1rem;
    height: 1rem;
  }

  .ohne-rich-text-block-type {
    padding: 0 0.375rem;
    font-weight: 500;
  }

  .ohne-rich-text-block-type > span {
    min-width: 5rem;
    text-align: left;
  }

  .ohne-dropdown-item.ohne-rich-text-block-active,
  .ohne-dropdown-item.ohne-rich-text-block-active:focus {
    background-color: hsl(var(--ohne-accent));
    color: hsl(var(--ohne-accent-foreground));
  }

  .ohne-rich-text-block-menu .ohne-dropdown-item + .ohne-dropdown-item {
    margin-top: 1px;
  }
`;

/**
 * The formatting toolbar of a rich text editor, or nothing when the field's options leave no button.
 * A block value gets a fixed toolbar: the block-type dropdown, the marks and the link, then clear formatting.
 * An `inline` value gets a bubble toolbar instead, which floats above a selection once it settles.
 * The bubble hides when the selection collapses or focus leaves the frame.
 * Buttons never take focus from a pointer, so the selection stays where it is.
 * A mark button is pressed when the whole selection has its mark, the link button when it touches a link.
 * The block-type dropdown names the current type, even a disallowed one, and offers only allowed ones.
 * The whole field is one tab stop: `Alt-F10` enters the toolbar, arrows, Home and End move along it.
 * Escape returns to the surface with the selection where it was.
 *
 * @example
 * ```ts
 * const toolbar = richTextToolbar(editor, { options, labels: () => labels, onLink: openLinkPopup })
 * if (toolbar) editor.element.prepend(toolbar.element)
 * ```
 */
export function richTextToolbar<C extends string>(
  editor: RichTextEditor<C>,
  config: RichTextToolbarOptions,
): RichTextToolbar | undefined {
  const { options = {} } = config;
  const {
    inline = false,
    elements = RICH_TEXT_DEFAULT_ELEMENTS,
    marks = RICH_TEXT_DEFAULT_MARKS,
    links = true,
  } = options;
  const labels = computed(config.labels);
  const off = (): boolean => config.disabled?.() ?? false;
  const kinds = inline ? [] : BLOCK_KINDS.filter((kind) => kind === 'p' || elements.includes(kind));
  const allowedMarks = RICH_TEXT_MARKS.filter((mark) => marks.includes(mark));
  const onLink = links === false ? undefined : config.onLink;
  let recent: HTMLElement | undefined;

  const kindLabel = (kind: BlockKind): string => {
    const text = labels.value;
    if (kind === 'p') return text.paragraph;
    if (kind === 'ul') return text.bulletList;
    if (kind === 'ol') return text.orderedList;
    if (kind === 'blockquote') return text.quote;
    return text.heading(Number(kind[1]) as RichTextHeadingLevel);
  };

  const setKind = (kind: BlockKind): void => {
    if (kind === 'ul' || kind === 'ol') {
      if (editor.blockType() !== kind) editor.run((state) => toggleList(state, kind === 'ol'));
    } else {
      editor.run((state) => setBlockType(state, kind));
    }
  };

  const act = (command: RichTextCommand<C>) => (): void => {
    editor.run(command);
    if (!element.contains(document.activeElement)) editor.surface.focus();
  };

  const tool = (
    name: IconName,
    label: () => string,
    spec: string,
    run: () => void,
    state: { pressed?: () => boolean; disabled?: () => boolean } = {},
  ): HTMLElement => {
    const el = h(
      'button',
      {
        type: 'button',
        class: 'ohne-raw ohne-rich-text-tool',
        tabindex: '-1',
        disabled: () => off() || (state.disabled?.() ?? false),
        'aria-label': label,
        'aria-pressed': state.pressed && (() => String(state.pressed!())),
        'aria-keyshortcuts': ariaKeyShortcut(spec),
        onClick: run,
      },
      icon(name),
    );
    onCleanup(attachTooltip(el, () => `${label()} \`${keySpecLabel(spec)}\``));
    return el;
  };

  const blockType = (): HTMLElement => {
    const open = ref(false);
    const close = (): void => {
      open.value = false;
    };
    const trigger = h(
      'button',
      {
        type: 'button',
        class: 'ohne-raw ohne-rich-text-tool ohne-rich-text-block-type',
        tabindex: '-1',
        disabled: off,
        'aria-haspopup': 'menu',
        'aria-expanded': () => String(open.value),
        onClick: () => (open.value = !open.value),
      },
      h('span', null, () => kindLabel(editor.blockType())),
      icon('chevron-down'),
    );
    onCleanup(attachTooltip(trigger, () => labels.value.blockType));

    const menu = (): HTMLElement => {
      const current = untracked(() => editor.blockType());
      const items = kinds.map((kind) => {
        const item = dropdownItem(
          [
            icon(BLOCK_ICONS[kind]),
            h('span', null, () => kindLabel(kind)),
            h('kbd', null, h('span', null, keySpecLabel(RICH_TEXT_KEYS[kind]))),
          ],
          {
            onClick: () => {
              close();
              setKind(kind);
            },
          },
        );
        if (kind === current) item.classList.add('ohne-rich-text-block-active');
        return item;
      });
      return dropdown(items, {
        reference: trigger,
        size: -1,
        class: 'ohne-rich-text-block-menu',
        onClose: close,
      }).root;
    };

    return h(
      'div',
      { class: 'ohne-flex' },
      trigger,
      when(() => open.value, menu),
    );
  };

  const markTools = allowedMarks.map((mark) =>
    tool(
      MARK_ICONS[mark],
      () => labels.value[mark],
      RICH_TEXT_KEYS[mark],
      act((state) => toggleMark(state, mark)),
      { pressed: () => editor.activeMarks().includes(mark) },
    ),
  );
  const linkTool =
    onLink &&
    tool(
      'link',
      () => labels.value.link,
      RICH_TEXT_KEYS.link,
      () => onLink(),
      {
        pressed: () => editor.linked(),
      },
    );
  const clearTool =
    allowedMarks.length > 0
      ? tool(
          'clear-formatting',
          () => labels.value.clearFormatting,
          RICH_TEXT_KEYS.clearMarks,
          act(clearMarks),
          { disabled: () => !editor.marked() },
        )
      : undefined;

  const groups = [
    kinds.length > 1 ? [blockType()] : [],
    [...markTools, ...(linkTool ? [linkTool] : [])],
    clearTool ? [clearTool] : [],
  ].filter((group) => group.length > 0);
  if (groups.length === 0) return undefined;

  const element = h(
    'div',
    {
      class: inline ? 'ohne-rich-text-bubble' : 'ohne-rich-text-toolbar',
      role: 'toolbar',
      popover: inline ? 'manual' : undefined,
      'aria-label': () => labels.value.toolbar,
      'aria-controls': editor.surface.id || undefined,
      onMousedown: (event: MouseEvent) => event.preventDefault(),
      onFocusin: (event: FocusEvent) => {
        if (event.target instanceof HTMLElement && event.target.matches(TOOL)) {
          recent = event.target;
        }
      },
      onKeydown: (event: KeyboardEvent) => {
        const tools = [...element.querySelectorAll<HTMLElement>(TOOL)];
        const current = tools.find((el) => el === document.activeElement);
        const move = MOVES.get(event.key);
        if (!current) return;
        if (event.key === 'Escape') {
          event.stopPropagation();
          editor.surface.focus();
        } else if (move) {
          move(current, tools)?.focus();
        } else {
          return;
        }
        event.preventDefault();
      },
    },
    groups.map((group, index) => [
      index > 0 ? h('span', { class: 'ohne-rich-text-separator' }) : null,
      group,
    ]),
  );

  const enter = (): void => {
    const target =
      recent?.isConnected && recent.matches(TOOL) ? recent : element.querySelector(TOOL);
    (target as HTMLElement | null)?.focus();
  };

  if (!inline) return { element, focus: enter };

  const shown = ref(false);
  const reveal = debounce(() => (shown.value = true), SETTLE_MS);
  const surfaceFocused = (): boolean => document.activeElement === editor.surface;

  const place = (): void => {
    const selection = document.getSelection();
    const range =
      selection && selection.rangeCount > 0 && editor.surface.contains(selection.anchorNode)
        ? selection.getRangeAt(0).getBoundingClientRect()
        : undefined;
    const rect =
      range && (range.width > 0 || range.height > 0)
        ? range
        : editor.surface.getBoundingClientRect();
    const placed = placeFloating({
      reference: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      floating: { width: element.offsetWidth, height: element.offsetHeight },
      viewport: {
        width: document.documentElement.clientWidth,
        height: document.documentElement.clientHeight,
      },
      placement: 'top',
      flip: true,
      offset: BUBBLE_GAP,
      shiftPadding: BUBBLE_GAP,
    });
    placeFixed(element, placed.x, placed.y);
  };

  const hide = (): void => {
    reveal.cancel();
    shown.value = false;
  };

  const sync = (): void => {
    const collapsed = isCollapsed(editor.state().selection);
    if (element.contains(document.activeElement)) return;
    if (off() || collapsed || !surfaceFocused()) hide();
    else if (untracked(() => shown.value)) place();
    else reveal();
  };

  const reposition = (): void => {
    if (untracked(() => shown.value)) place();
  };

  batchedEffect(sync);
  effect(() => {
    if (shown.value) {
      raiseToTopLayer(element);
      place();
    } else if (element.matches(':popover-open')) {
      element.hidePopover();
    }
  });

  const frame = editor.element;
  const onFocusOut = (event: FocusEvent): void => {
    if (!(event.relatedTarget instanceof Node && frame.contains(event.relatedTarget))) hide();
  };
  editor.surface.addEventListener('focus', sync);
  frame.addEventListener('focusout', onFocusOut);
  window.addEventListener('scroll', reposition, { capture: true, passive: true });
  window.addEventListener('resize', reposition);
  onCleanup(() => {
    reveal.cancel();
    editor.surface.removeEventListener('focus', sync);
    frame.removeEventListener('focusout', onFocusOut);
    window.removeEventListener('scroll', reposition, { capture: true });
    window.removeEventListener('resize', reposition);
  });

  return {
    element,
    focus() {
      reveal.cancel();
      shown.value = true;
      enter();
    },
  };
}
