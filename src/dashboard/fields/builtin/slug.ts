import type { Ref } from '../../../utils/reactive/ref.ts';
import type { SlugFieldOptions } from '../known-field-types.ts';

import { parseFieldPath } from '../../../utils/condition/field-path.ts';
import { scopedValue } from '../../../utils/condition/scoped-value.ts';
import { isNullish } from '../../../utils/is/is-nullish.ts';
import { isUndefined } from '../../../utils/is/is-undefined.ts';
import { effect } from '../../../utils/reactive/effect.ts';
import { ref } from '../../../utils/reactive/ref.ts';
import { untracked } from '../../../utils/reactive/untracked.ts';
import { canonicalSlug } from '../../../utils/slug/canonical-slug.ts';
import { slugify } from '../../../utils/slug/slugify.ts';
import { h } from '../../render/h.ts';
import { useT } from '../../runtime/use-t.ts';
import { button } from '../../ui/button.ts';
import { icon } from '../../ui/icon.ts';
import { textInput } from '../../ui/text-input.ts';
import { checkedReading } from '../_checked-reading.ts';
import { cellEditor } from '../cell-editor.ts';
import { describeControl, fieldPlaceholder } from '../field-row.ts';
import { dimMark, type FieldType, registerFieldType } from '../field-type.ts';
import { parseTextValue } from '../parse.ts';

/**
 * The `slug` field type: cell display, inline cell editor, form control, and filter.
 * The cell shows the slug in mono; every entry point stores its canonical form, as `canonicalSlug` writes it.
 * With `from`, an empty slug follows that sibling as you type; a toggle in the input links or unlinks it.
 * Typing unlinks; a stored record starts unlinked unless its source is empty, so opening it edits nothing.
 * An empty slug while following reads as untouched, so a record whose locale has no row yet still saves.
 */
export const slugType: FieldType<SlugFieldOptions> = {
  display({ value }) {
    return () => {
      const current = value();
      if (isNullish(current)) return dimMark('-');
      const text = String(current as string);
      return h('span', { class: 'cell-mono ohne-truncate', title: text }, text);
    };
  },
  editor({ field, value, commit, cancel }) {
    const current = value();
    return cellEditor({
      initial: isNullish(current) ? '' : String(current as string),
      mono: true,
      commit(text) {
        if (field.nullable && text.trim() === '') return commit(null);
        const canonical = canonicalSlug(text, field.options);
        return canonical === '' ? false : commit(canonical);
      },
      cancel,
    });
  },
  control({ field, initial, path, disabled, onInput, ancestors }) {
    const t = useT();
    const off = disabled === true;
    const { from } = field.options ?? {};
    const source = isUndefined(from) ? undefined : parseFieldPath(from);
    const base = ref(initial);
    const raw = ref(isNullish(initial) ? '' : String(initial as string));
    const routed = ref('');
    const unset = (value: unknown): boolean => isNullish(value) || value === '';
    const sourceText = (): string =>
      isUndefined(source) ? '' : String(scopedValue(ancestors?.() ?? [], source) ?? '');
    // A stored record follows only while its source is empty too, so opening it never edits it.
    const following = ref(
      !isUndefined(source) &&
        unset(initial) &&
        (isUndefined(initial) || untracked(sourceText) === ''),
    );

    const canonical = (): string => canonicalSlug(raw.value, field.options);
    const error = (): string => routed.value;

    // A restored slug stays linked when its restored source derives it, else the step held a slug of its own.
    const pinned = ref<string | undefined>(undefined);
    effect(() => {
      if (!following.value) return;
      const derived = slugify(sourceText());
      const restored = pinned.value;
      if (!isUndefined(restored)) {
        pinned.value = undefined;
        if (restored !== derived) {
          following.value = false;
          raw.value = restored;
          return;
        }
      }
      raw.value = derived;
    });

    const toggle = isUndefined(source)
      ? undefined
      : button(
          () => {
            const glyph = icon(following.value ? 'link' : 'link-off');
            glyph.setAttribute('width', '1.125em');
            glyph.setAttribute('height', '1.125em');
            return glyph;
          },
          {
            variant: 'ghost',
            disabled: off ? (): boolean => true : undefined,
            onClick: () => {
              following.value = !following.value;
              routed.value = '';
              onInput(true);
            },
          },
        );
    if (!isUndefined(toggle)) {
      toggle.tabIndex = -1;
      toggle.title = t('dashboard.slug.follow');
      toggle.setAttribute('aria-label', toggle.title);
      // `button` takes a static variant, so the classes patch here; its class attribute is not reactive.
      effect(() => {
        toggle.classList.toggle('ohne-button-accent', following.value);
        toggle.classList.toggle('ohne-button-ghost', !following.value);
        toggle.setAttribute('aria-pressed', String(following.value));
      });
    }

    const box = textInput(raw, {
      disabled: () => off,
      placeholder: fieldPlaceholder(field),
      suffix: toggle,
    });
    const input = box.querySelector('input') as HTMLInputElement;
    input.addEventListener('input', () => {
      following.value = false;
      routed.value = '';
      onInput();
    });
    input.addEventListener('blur', () => {
      if (raw.value.trim() !== '') raw.value = canonical();
    });
    describeControl(input, field, path, error);

    // An empty slug over no stored one, or while following, is no edit, as a locale without a row reads.
    const idle = (): boolean => canonical() === '' && (following.value || unset(base.value));
    const wire = (): unknown => {
      const value = canonical();
      if (value !== '') return value;
      return base.value === '' ? '' : parseTextValue(field, '');
    };
    // A following slug is derived, so it never counts as an edit of its own.
    const dirty = (): boolean => {
      if (following.value || idle()) return false;
      if (isUndefined(base.value)) return raw.value.trim() !== '';
      return wire() !== (isNullish(base.value) ? null : String(base.value as string));
    };
    const draft = (): unknown => {
      if (isUndefined(base.value) && raw.value.trim() === '') return undefined;
      return raw.value === '' ? parseTextValue(field, '') : raw.value;
    };
    const show = (value: unknown): void => {
      routed.value = '';
      if (following.value && !unset(value)) {
        pinned.value = String(value as string);
        return;
      }
      raw.value = isNullish(value) ? '' : String(value as string);
      following.value =
        !isUndefined(source) &&
        unset(value) &&
        (isUndefined(value) || untracked(sourceText) === '');
    };

    return {
      element: box,
      read() {
        if (idle()) return isUndefined(base.value) ? {} : { value: base.value };
        if (isUndefined(base.value) && raw.value.trim() === '') return {};
        const value = wire();
        return checkedReading(
          value,
          value === '' && dirty() ? 'validation.invalidSlug' : undefined,
        );
      },
      draft,
      setErrors(errors) {
        routed.value = errors[''] ?? '';
        for (const [key, message] of Object.entries(errors)) {
          if (key !== '') return message;
        }
        return '';
      },
      error,
      dirty,
      focus() {
        input.focus();
      },
      revert() {
        show(base.value);
      },
      rebase(value) {
        base.value = value;
        routed.value = '';
        if (unset(value) || !following.value) return;
        following.value = false;
        raw.value = String(value as string);
      },
      restore: show,
    };
  },
  filter: {
    operators: () => ['eq', 'ne', 'startsWith', 'endsWith', 'contains', 'notContains'],
    seed: () => '',
    input({ field, operator, value, set, commit, inputID }) {
      const t = useT();
      const bridged: Ref<string> = {
        get value() {
          return String(value());
        },
        set value(next) {
          set(next);
        },
      };
      // A nested part keeps the slashes you typed at its ends, so `docs/` never widens to `docs`.
      const canonicalPart = (text: string): string => {
        const canonical = canonicalSlug(text, field.options);
        const nested = field.options?.nested === true;
        const op = operator();
        if (!nested || op === 'eq' || op === 'ne' || canonical === '') return canonical;
        const trimmed = text.trim();
        return `${trimmed.startsWith('/') ? '/' : ''}${canonical}${trimmed.endsWith('/') ? '/' : ''}`;
      };
      return textInput(bridged, {
        id: inputID,
        name: inputID,
        placeholder: () => t('dashboard.filter.empty'),
        onBlur: () => {
          set(canonicalPart(String(value())));
          commit();
        },
      });
    },
  },
};

registerFieldType('slug', slugType);
