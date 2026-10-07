import type { RecordLink } from '../../../utils/rich-text/link.ts';
import type {
  RichText,
  RichTextElement,
  RichTextMark,
  RichTextOptions,
} from '../../../utils/rich-text/rich-text.ts';
import type { DashboardField } from '../../runtime/meta-types.ts';
import type { Selection } from '../../ui/rich-text-model.ts';

import { isArray } from '../../../utils/is/is-array.ts';
import { isBoolean } from '../../../utils/is/is-boolean.ts';
import { isNumber } from '../../../utils/is/is-number.ts';
import { isString } from '../../../utils/is/is-string.ts';
import { isUndefined } from '../../../utils/is/is-undefined.ts';
import { deepEqual } from '../../../utils/object/deep-equal.ts';
import { computed } from '../../../utils/reactive/computed.ts';
import { onCleanup } from '../../../utils/reactive/effect-scope.ts';
import { ref } from '../../../utils/reactive/ref.ts';
import { isRichText } from '../../../utils/rich-text/is-rich-text.ts';
import { normalizeRichText } from '../../../utils/rich-text/normalize-rich-text.ts';
import { richTextLength } from '../../../utils/rich-text/rich-text-length.ts';
import { richTextToText } from '../../../utils/rich-text/rich-text-to-text.ts';
import { RICH_TEXT_ELEMENTS, RICH_TEXT_MARKS } from '../../../utils/rich-text/rich-text.ts';
import { recordHref } from '../../../utils/route/record-href.ts';
import { css } from '../../render/css.ts';
import { h } from '../../render/h.ts';
import { useT } from '../../runtime/use-t.ts';
import { richTextEditor } from '../../ui/rich-text-editor.ts';
import { readableCollection } from '../_search.ts';
import { describeControl } from '../field-row.ts';
import { controlIDs, dimMark, type FieldType, registerFieldType } from '../field-type.ts';
import { labelOf } from '../labels.ts';

const TITLE_LENGTH = 500;
const BLOCK_PATH = /^\[(\d+)\]/;
const ITEM_PATH = /^\.(?:list\.)?items\[(\d+)\]/;

// A form rebuild disposes the control; a focused one leaves its selection here for its successor.
const handoffs = new Map<string, Selection>();

css`
  .ohne-rich-text-counter {
    align-self: flex-end;
    margin-top: -0.25em;
    padding: 0 0.5em 0.25rem;
    color: hsl(var(--ohne-muted-foreground));
    font-size: 0.75rem;
    font-variant-numeric: tabular-nums;
    pointer-events: none;
  }

  .ohne-rich-text-counter-over {
    color: hsl(var(--ohne-destructive));
  }
`;

/**
 * The `richText` field type: cell display and form control.
 * The cell shows the value's plain text, truncated, with its first characters as the title.
 * The control is the rich text editor, reading as the canonical form of its document.
 * An emptied document reads as `null` on a nullable field and as `[]` otherwise.
 * Server errors below the field mark the leaf they point into, and the first one becomes the field's line.
 * A rebuilt form hands the editor's selection to the control that takes its place.
 * A declared `max` shows a counter that never blocks typing.
 * The edit popup owns editing, so the cell offers no inline editor.
 */
export const richTextType: FieldType = {
  display({ value }) {
    return () => {
      const current = value();
      if (!isRichText(current) || current.length === 0) return dimMark('-');
      const text = richTextToText(current);
      return h('span', { class: 'ohne-truncate', title: text.slice(0, TITLE_LENGTH) }, text);
    };
  },
  control({ field, initial, path, disabled, onInput }) {
    const t = useT();
    const options = optionsOf(field);
    const ids = controlIDs(path);
    const off = disabled === true;
    const max = field.options?.max;
    const base = ref(initial);
    const doc = ref(docOf(initial));
    const touched = ref(false);
    const routed = ref('');

    const error = (): string => routed.value;
    const canonical = computed(() => normalizeRichText(doc.value, options));
    const baseline = computed(() => normalizeRichText(docOf(base.value), options));
    const count = (): number => richTextLength(canonical.value);
    const counterID = `${ids.input}-count`;

    const counter = (max: number): HTMLElement =>
      h(
        'div',
        {
          id: counterID,
          class: () =>
            `ohne-rich-text-counter${count() > max ? ' ohne-rich-text-counter-over' : ''}`,
          'aria-label': () => t('dashboard.richText.countLabel', { count: count(), max }),
        },
        () => t('dashboard.richText.count', { count: count(), max }),
      );

    const editor = richTextEditor({
      value: doc.value,
      options,
      disabled: () => off,
      error: () => routed.value !== '',
      placeholder: field.placeholder,
      missingLabel: () => t('dashboard.richText.missingLink'),
      links: { href: recordLinkHref, label: recordLinkLabel },
      suffix: isNumber(max) ? counter(max) : undefined,
      onChange(next) {
        doc.value = next;
        touched.value = true;
        routed.value = '';
        onInput();
      },
    });

    describeControl(editor.surface, field, path, error);
    if (isNumber(max)) {
      editor.surface.setAttribute('aria-describedby', `${ids.description} ${counterID}`);
    }

    const handoff = handoffs.get(ids.input);
    if (!isUndefined(handoff)) {
      handoffs.delete(ids.input);
      editor.select(handoff);
    }
    onCleanup(() => {
      if (editor.surface.ownerDocument.activeElement === editor.surface) {
        handoffs.set(ids.input, editor.state().selection);
      }
    });

    return {
      element: editor.element,
      read() {
        if (!touched.value && isUndefined(initial)) return {};
        const value = canonical.value;
        return { value: value.length === 0 && field.nullable ? null : value };
      },
      setErrors(errors) {
        let first = '';
        const paths: number[][] = [];
        for (const [key, message] of Object.entries(errors)) {
          if (key === '') continue;
          if (first === '') first = message;
          const leaf = leafPathOf(key);
          if (!isUndefined(leaf)) paths.push(leaf);
        }
        routed.value = errors[''] ?? first;
        editor.markErrors(paths);
        return '';
      },
      error,
      dirty: () => !deepEqual(canonical.value, baseline.value),
      focus: () => editor.focus(),
      revert() {
        doc.value = docOf(base.value);
        editor.setDoc(doc.value);
        editor.markErrors([]);
        touched.value = false;
        routed.value = '';
      },
      rebase(value) {
        base.value = value;
        routed.value = '';
      },
    };
  },
};

/**
 * The stored value as a document, or an empty one when it is not rich text.
 */
function docOf(value: unknown): RichText {
  return isRichText(value) ? value : [];
}

/**
 * The field's declared options as the editor's, with a malformed entry left to the editor's default.
 */
function optionsOf(field: DashboardField): RichTextOptions {
  const { inline, elements, marks, links, lineBreaks } = field.options ?? {};
  return {
    inline: inline === true,
    elements: isArray(elements) ? elements.filter(isElement) : undefined,
    marks: isArray(marks) ? marks.filter(isMark) : undefined,
    links: isBoolean(links) ? links : isArray(links) ? links.filter(isString) : undefined,
    lineBreaks: lineBreaks !== false,
  };
}

/**
 * Whether a declared element is one the value may allow.
 */
function isElement(value: unknown): value is RichTextElement {
  return isString(value) && (RICH_TEXT_ELEMENTS as readonly string[]).includes(value);
}

/**
 * Whether a declared mark is one a run may carry.
 */
function isMark(value: unknown): value is RichTextMark {
  return isString(value) && (RICH_TEXT_MARKS as readonly string[]).includes(value);
}

/**
 * The path of the leaf an error path points into: the block index, then each list item on the way.
 * `[2].items[0].list.items[1].content[0].link.url` gives `[2, 0, 1]`, and a path without a block gives nothing.
 */
function leafPathOf(key: string): number[] | undefined {
  const block = BLOCK_PATH.exec(key);
  if (block === null) return undefined;
  const path = [Number(block[1])];
  let rest = key.slice(block[0].length);
  for (let item = ITEM_PATH.exec(rest); item !== null; item = ITEM_PATH.exec(rest)) {
    path.push(Number(item[1]));
    rest = rest.slice(item[0].length);
  }
  return path;
}

/**
 * The dashboard path that opens a record link's target, when the user can read its collection.
 */
function recordLinkHref(link: RecordLink): string | undefined {
  const collection = readableCollection(link.collection);
  return isUndefined(collection) ? undefined : recordHref(collection, link.record);
}

/**
 * The resolved label of a record link's target, `undefined` while it is still loading.
 */
function recordLinkLabel(link: RecordLink): string | undefined {
  return labelOf(link.collection, link.record);
}

registerFieldType('richText', richTextType);
