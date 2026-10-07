import type { Ref } from '../../../utils/reactive/ref.ts';
import type { Link } from '../../../utils/rich-text/link.ts';
import type { Child } from '../../render/insert.ts';
import type { Primitive } from '../../ui/button-group.ts';
import type { RichTextEditor } from '../../ui/rich-text-editor.ts';
import type { RichTextCommand } from '../../ui/rich-text-input.ts';
import type { LinkTarget, RecordTarget } from '../_link-model.ts';

import { isUndefined } from '../../../utils/is/is-undefined.ts';
import { deepEqual } from '../../../utils/object/deep-equal.ts';
import { computed } from '../../../utils/reactive/computed.ts';
import { effectScope } from '../../../utils/reactive/effect-scope.ts';
import { effect } from '../../../utils/reactive/effect.ts';
import { ref } from '../../../utils/reactive/ref.ts';
import { untracked } from '../../../utils/reactive/untracked.ts';
import { checkLink } from '../../../utils/rich-text/check-link.ts';
import { isRecordLink } from '../../../utils/rich-text/is-record-link.ts';
import { normalizeLink } from '../../../utils/rich-text/normalize-link.ts';
import { css } from '../../render/css.ts';
import { h } from '../../render/h.ts';
import { when } from '../../render/when.ts';
import { useT } from '../../runtime/use-t.ts';
import { button } from '../../ui/button.ts';
import { dynamicSelect } from '../../ui/dynamic-select.ts';
import { fieldLabel } from '../../ui/field-label.ts';
import { fieldMessage } from '../../ui/field-message.ts';
import { field } from '../../ui/field.ts';
import { useHotkeys } from '../../ui/hotkeys.ts';
import { icon } from '../../ui/icon.ts';
import { popup } from '../../ui/popup-overlay.ts';
import { removeLink, setLink } from '../../ui/rich-text-commands.ts';
import { sliceRichText } from '../../ui/rich-text-input.ts';
import { isCollapsed, leaves, linkRangeAt } from '../../ui/rich-text-model.ts';
import { switchInput } from '../../ui/switch.ts';
import { textInput } from '../../ui/text-input.ts';
import { choiceKeyword, linkChoiceValue, linkOf, linkTargetOf } from '../_link-model.ts';
import { fallbackLabel, labelOf } from '../labels.ts';
import { type LinkChoices, targetHref } from './_link-choices.ts';

const WIDTH = '26rem';

let sequence = 0;

css`
  .ohne-link-resolved {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    width: fit-content;
    max-width: 100%;
    color: hsl(var(--ohne-muted-foreground));
    font-size: 0.8125rem;
    line-height: 1rem;
    text-decoration: none;
  }

  .ohne-link-resolved:is(:hover, :focus-visible) {
    color: hsl(var(--ohne-foreground));
  }

  .ohne-link-resolved > svg {
    flex-shrink: 0;
    font-size: 0.875rem;
  }
`;

/**
 * Opens the link popup over a rich text editor's selection, to insert, edit or remove a link.
 * The target is one select over the allowed records and typed addresses.
 * A caret outside a link also gets a Text input; left empty, the record's label or the address is inserted.
 * A record link takes an anchor, and any link can open in a new tab.
 * A link to a missing record says so, and Remove stays one click away.
 * Apply, Enter in an input, and `Mod-s` apply; the popup then closes and the surface takes focus back.
 * The edit lands on the selection the editor had when the popup opened.
 */
export function openLinkPopup(editor: RichTextEditor, choices: LinkChoices): void {
  const scope = effectScope();
  scope.run(() => {
    const t = useT();
    const { doc, selection } = editor.state();
    const collapsed = isCollapsed(selection);
    const current = collapsed
      ? linkRangeAt(doc, selection.head)?.link
      : leaves(sliceRichText(doc, selection))
          .flatMap((entry) => entry.leaf.content)
          .find((run) => run.link)?.link;
    const inserting = collapsed && isUndefined(current);
    const stored = isUndefined(current) ? undefined : normalizeLink(current);
    const id = `ohne-link-${++sequence}`;

    const model = ref<Primitive>(isUndefined(current) ? null : linkChoiceValue(current));
    const hash = ref(isRecordLink(stored) ? (stored.hash ?? '') : '');
    const newTab = ref(stored?.newTab === true);
    const text = ref('');

    const target = computed(() => linkTargetOf(model.value));
    const record = computed(() => {
      const value = target.value;
      return !isUndefined(value) && 'collection' in value ? value : undefined;
    });
    const badHash = computed(
      () => !isUndefined(record.value) && invalidHash(record.value, hash.value),
    );
    const link = computed(() =>
      isUndefined(target.value)
        ? undefined
        : linkOf(target.value, { hash: hash.value, newTab: newTab.value }),
    );
    const changed = computed(() => text.value !== '' || !deepEqual(link.value, stored));
    const broken = computed(() => !isUndefined(record.value) && choices.missing(record.value));

    const insertText = (): string => {
      const value = target.value;
      if (isUndefined(value)) return '';
      if ('url' in value) return value.url;
      return labelOf(value.collection, value.record) ?? fallbackLabel(value.record);
    };

    let settled = false;
    const settle = (command?: RichTextCommand): void => {
      if (settled) return;
      settled = true;
      if (command) editor.run((state) => command({ ...state, selection }));
      void handle.close().then(() => {
        scope.dispose();
        editor.surface.focus();
      });
    };

    const apply = (): void => {
      const next = link.value;
      if (isUndefined(next) || badHash.value) return;
      const inserted = inserting ? text.value || untracked(insertText) : '';
      settle((state) => setLink(state, next, inserted));
    };

    const select = dynamicSelect(model, {
      id,
      choicesResolver: choices.choicesResolver,
      selectedChoiceResolver: choices.selectedChoiceResolver,
      placeholder: untracked(() =>
        t(
          choices.collections.length > 0
            ? 'dashboard.link.placeholder'
            : 'dashboard.link.urlPlaceholder',
        ),
      ),
      searchLabel: untracked(() => t('dashboard.searchPlaceholder')),
      noResultsLabel: untracked(() => t('dashboard.noResultsFound')),
      get initialKeyword() {
        return choiceKeyword(model.value);
      },
    });
    select.querySelector('[role="combobox"]')?.setAttribute('data-autofocus', '');

    const resolved = (): Child => {
      const value = target.value;
      if (isUndefined(value) || broken.value) return null;
      const href = targetHref(value);
      if (isUndefined(href)) return null;
      return h(
        'a',
        { class: 'ohne-link-resolved', href, target: '_blank', rel: 'noopener noreferrer' },
        h('span', { class: 'ohne-truncate' }, () => ('url' in value ? value.url : insertText())),
        icon('external-link'),
      );
    };

    const closeButton = button(icon('x'), {
      size: -2,
      variant: 'ghost',
      class: 'ohne-ml-auto',
      onClick: () => settle(),
    });
    effect(() => {
      closeButton.title = t('dashboard.close');
    });

    const body = h(
      'div',
      { onKeydown: (event: KeyboardEvent) => applyOnEnter(event, apply) },
      field([
        fieldLabel(h('label', { for: id }, () => t('dashboard.link.target'))),
        select,
        resolved,
        when(
          () => broken.value,
          () => fieldMessage(() => t('dashboard.link.missing'), { error: () => true }),
        ),
      ]),
      inserting
        ? field([
            fieldLabel(h('label', { for: `${id}-text` }, () => t('dashboard.link.text'))),
            textInput(text, { id: `${id}-text`, placeholder: insertText }),
          ])
        : null,
      when(
        () => !isUndefined(record.value),
        () => hashField(hash, `${id}-hash`, () => badHash.value),
      ),
      newTabField(newTab),
    );

    const handle = popup(body, {
      size: -1,
      width: WIDTH,
      header: h(
        'div',
        { class: 'ohne-row' },
        h('span', { class: 'ohne-medium' }, () =>
          t(isUndefined(current) ? 'dashboard.link.insert' : 'dashboard.link.edit'),
        ),
        closeButton,
      ),
      footer: h(
        'div',
        { class: 'ohne-justify-between' },
        button(() => t('dashboard.cancel'), { variant: 'outline', onClick: () => settle() }),
        h(
          'div',
          { class: 'ohne-row' },
          isUndefined(current)
            ? null
            : button(() => t('dashboard.link.remove'), {
                variant: 'outline',
                destructiveHover: true,
                onClick: () => settle(removeLink),
              }),
          applyButton(
            () => changed.value,
            () => isUndefined(link.value) || badHash.value,
            apply,
          ),
        ),
      ),
      onClose: () => settle(),
    });

    useHotkeys({ allowInOverlays: true, target: handle.root }).listen('save', (event) => {
      event.preventDefault();
      apply();
    });
  });
}

/**
 * Opens the "Link options" popup of a `link` field: the anchor of a record link, and the new tab switch.
 * Apply, Enter in an input, and `Mod-s` hand the link to `onApply` when it changed.
 * Focus returns to the element that had it when the popup opened.
 */
export function openLinkOptions(link: Link, onApply: (link: Link) => void): void {
  const scope = effectScope();
  scope.run(() => {
    const t = useT();
    const returnFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const stored = normalizeLink(link);
    const target: LinkTarget = isRecordLink(stored)
      ? { collection: stored.collection, record: stored.record }
      : { url: stored.url };
    const hash = ref(isRecordLink(stored) ? (stored.hash ?? '') : '');
    const newTab = ref(stored.newTab === true);
    const next = computed(() => linkOf(target, { hash: hash.value, newTab: newTab.value }));
    const badHash = computed(() => 'collection' in target && invalidHash(target, hash.value));
    const changed = computed(() => !deepEqual(next.value, stored));
    const id = `ohne-link-${++sequence}`;

    let settled = false;
    const settle = (apply: boolean): void => {
      if (settled || (apply && badHash.value)) return;
      settled = true;
      if (apply && changed.value) onApply(next.value);
      void handle.close().then(() => {
        scope.dispose();
        returnFocus?.focus();
      });
    };

    const closeButton = button(icon('x'), {
      size: -2,
      variant: 'ghost',
      class: 'ohne-ml-auto',
      onClick: () => settle(false),
    });
    effect(() => {
      closeButton.title = t('dashboard.close');
    });

    const handle = popup(
      h(
        'div',
        { onKeydown: (event: KeyboardEvent) => applyOnEnter(event, () => settle(true)) },
        'collection' in target ? hashField(hash, `${id}-hash`, () => badHash.value) : null,
        newTabField(newTab),
      ),
      {
        size: -1,
        width: WIDTH,
        header: h(
          'div',
          { class: 'ohne-row' },
          h('span', { class: 'ohne-medium' }, () => t('dashboard.link.options')),
          closeButton,
        ),
        footer: h(
          'div',
          { class: 'ohne-justify-between' },
          button(() => t('dashboard.cancel'), { variant: 'outline', onClick: () => settle(false) }),
          applyButton(
            () => changed.value,
            () => badHash.value,
            () => settle(true),
          ),
        ),
        onClose: () => settle(false),
      },
    );

    useHotkeys({ allowInOverlays: true, target: handle.root }).listen('save', (event) => {
      event.preventDefault();
      settle(true);
    });
  });
}

/**
 * The anchor input, with a `#` prefix, and its description or error line below.
 */
function hashField(hash: Ref<string>, id: string, invalid: () => boolean): HTMLElement {
  const t = useT();
  return field([
    fieldLabel(h('label', { for: id }, () => t('dashboard.link.hash'))),
    textInput(hash, {
      id,
      prefix: h('span', { class: 'ohne-muted' }, '#'),
      autocomplete: 'off',
      error: invalid,
    }),
    fieldMessage(
      () => t(invalid() ? 'dashboard.link.invalidHash' : 'dashboard.link.hashDescription'),
      { error: invalid },
    ),
  ]);
}

/**
 * The "Open in a new tab" switch.
 */
function newTabField(newTab: Ref<boolean>): HTMLElement {
  const t = useT();
  return field(switchInput(newTab, () => t('dashboard.link.newTab')));
}

/**
 * The footer's Apply button, primary once something changed.
 */
function applyButton(changed: () => boolean, disabled: () => boolean, apply: () => void): Child {
  const t = useT();
  const make = (variant: 'primary' | 'outline'): HTMLElement =>
    button(() => t('dashboard.apply'), { variant, disabled, onClick: apply });
  return when(
    changed,
    () => make('primary'),
    () => make('outline'),
  );
}

/**
 * Applies on Enter in a text input; the target select handles its own Enter and never lets it bubble.
 */
function applyOnEnter(event: KeyboardEvent, apply: () => void): void {
  if (event.key === 'Enter' && !event.isComposing && event.target instanceof HTMLInputElement) {
    event.preventDefault();
    apply();
  }
}

/**
 * Whether `hash` is an anchor a link to the record may not carry, by the same rule a write checks.
 */
function invalidHash(target: RecordTarget, hash: string): boolean {
  const issues = checkLink(linkOf(target, { hash }), [target.collection]);
  return issues.some((issue) => issue.path === 'hash');
}
