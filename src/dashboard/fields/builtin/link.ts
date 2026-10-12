import type { Ref } from '../../../utils/reactive/ref.ts';
import type { Link } from '../../../utils/rich-text/link.ts';
import type { Child } from '../../render/insert.ts';
import type { DashboardField } from '../../runtime/meta-types.ts';
import type { Primitive } from '../../ui/button-group.ts';
import type { LinkFieldOptions } from '../known-field-types.ts';

import { isSafeHref } from '../../../utils/html/is-safe-href.ts';
import { isArray } from '../../../utils/is/is-array.ts';
import { isNull } from '../../../utils/is/is-null.ts';
import { isString } from '../../../utils/is/is-string.ts';
import { isUndefined } from '../../../utils/is/is-undefined.ts';
import { deepEqual } from '../../../utils/object/deep-equal.ts';
import { ref } from '../../../utils/reactive/ref.ts';
import { untracked } from '../../../utils/reactive/untracked.ts';
import { isLink } from '../../../utils/rich-text/is-link.ts';
import { isRecordLink } from '../../../utils/rich-text/is-record-link.ts';
import { normalizeLink } from '../../../utils/rich-text/normalize-link.ts';
import { typedHref } from '../../../utils/uri/typed-href.ts';
import { h } from '../../render/h.ts';
import { useT } from '../../runtime/use-t.ts';
import { loadVerdicts } from '../../runtime/verdicts.ts';
import { button } from '../../ui/button.ts';
import { dynamicSelect } from '../../ui/dynamic-select.ts';
import { textInput } from '../../ui/text-input.ts';
import { choiceKeyword, linkChoiceValue, linkOf, linkTargetOf } from '../_link-model.ts';
import { readableCollection } from '../_search.ts';
import { describeControl, fieldPlaceholder } from '../field-row.ts';
import { dimMark, type FieldType, registerFieldType } from '../field-type.ts';
import { fallbackLabel, labelOf } from '../labels.ts';
import { pickerTrigger } from '../record-picker.ts';
import { linkChoices, targetHref } from './_link-choices.ts';
import { openLinkOptions } from './_link-popup.ts';

/**
 * The `link` field type: cell display and form control.
 * The cell shows the record's label or the address as plain text, titled with its destination.
 * A composite cell digests the value as that label or address.
 * The control picks the target in one select over the allowed records and typed addresses.
 * Without `collections`, it is a text input read as an address, and an unsafe one is a local error.
 * Beside the target sit the table picker for one collection, an open button and the "Link options" button.
 * The options hold a record link's anchor and the new tab switch; a nullable field adds a clear button.
 * Picking another target keeps the new tab choice and drops the anchor.
 * The edit popup owns editing, so the cell offers no inline editor.
 */
export const linkType: FieldType<LinkFieldOptions> = {
  display({ value }) {
    return () => {
      const current = value();
      if (!isLink(current)) return dimMark('-');
      const text = linkText(current);
      return h('span', { class: 'ohne-truncate', title: targetHref(current) ?? text }, text);
    };
  },
  summary(value) {
    return isLink(value) ? linkText(value) : '';
  },
  control({ field, initial, path, disabled, onInput }) {
    const t = useT();
    const off = disabled === true;
    const declared = collectionsOf(field);
    let base = initial;

    const stored = (): Link | null => (isLink(base) ? normalizeLink(base) : null);
    const current = ref(stored());
    const touched = ref(false);
    const routed = ref('');
    const invalid = ref('');

    const error = (): string => routed.value || invalid.value;
    const change = (next: Link | null): void => {
      current.value = next;
      touched.value = true;
      routed.value = '';
      onInput();
    };

    let target: Child;
    let focusTarget: () => void;
    let address: AddressInput | undefined;

    if (declared.length === 0) {
      address = addressInput(current, change, invalid, off);
      describeControl(address.input, field, path, error);
      target = address.element;
      focusTarget = () => address?.input.focus();
    } else {
      const choices = linkChoices(declared);
      const model: Ref<Primitive> = {
        get value() {
          const link = current.value;
          return isNull(link) ? null : linkChoiceValue(link);
        },
        set value(next) {
          const picked = linkTargetOf(next);
          if (isUndefined(picked) || next === untracked(() => model.value)) return;
          change(linkOf(picked, { newTab: untracked(() => current.value?.newTab) }));
        },
      };
      const select = dynamicSelect(model, {
        disabled: () => off,
        choicesResolver: choices.choicesResolver,
        selectedChoiceResolver: choices.selectedChoiceResolver,
        name: path,
        placeholder: fieldPlaceholder(field) ?? (() => t('dashboard.link.placeholder')),
        searchLabel: () => t('dashboard.searchPlaceholder'),
        noResultsLabel: () => t('dashboard.noResultsFound'),
        get initialKeyword() {
          return choiceKeyword(model.value);
        },
      });
      const combobox = select.querySelector<HTMLElement>('[role="combobox"]');
      if (!isNull(combobox)) describeControl(combobox, field, path, error);
      const [only] = choices.collections;
      const picker =
        choices.collections.length === 1 && !isUndefined(only)
          ? pickerTrigger({
              field,
              target: only,
              values: () => {
                const link = current.value;
                return isRecordLink(link) && link.collection === only.name ? [link.record] : [];
              },
              multiple: false,
              disabled: off ? (): boolean => true : undefined,
              onApply: ([record]) => {
                if (isUndefined(record)) return;
                const newTab = untracked(() => current.value?.newTab);
                change(linkOf({ collection: only.name, record }, { newTab }));
              },
            })
          : undefined;
      target = [picker?.trigger, select, picker?.host];
      focusTarget = () => combobox?.focus();
    }

    const tools = (): Child => {
      const link = current.value;
      if (isNull(link)) return null;
      const settings = button(() => t('dashboard.link.options'), {
        icon: 'settings',
        iconOnly: true,
        variant: 'outline',
        disabled: off ? (): boolean => true : undefined,
        onClick: () => openLinkOptions(link, change),
      });
      const clear = field.nullable
        ? button(() => t('dashboard.clearSelection'), {
            icon: 'x',
            iconOnly: true,
            variant: 'outline',
            disabled: off ? (): boolean => true : undefined,
            onClick: () => {
              change(null);
              address?.sync();
            },
          })
        : null;
      return [openButton(link), settings, clear];
    };

    return {
      element: h('div', { class: 'ohne-row' }, target, tools),
      read() {
        const problem = address?.problem() ?? '';
        if (problem !== '') return { errors: { '': problem } };
        if (!touched.value && isUndefined(base)) return {};
        if (isNull(current.value) && !field.nullable) return {};
        return { value: current.value };
      },
      setErrors(errors) {
        routed.value = errors[''] ?? Object.values(errors)[0] ?? '';
        return '';
      },
      error,
      dirty: () => touched.value && !deepEqual(current.value, stored()),
      focus: () => focusTarget(),
      revert() {
        current.value = stored();
        touched.value = false;
        routed.value = '';
        address?.sync();
      },
      rebase(value) {
        base = value;
        current.value = stored();
        touched.value = false;
        routed.value = '';
        address?.sync();
      },
    };
  },
};

/**
 * The text naming a link: the record's label, its fallback while unresolved, or the address.
 */
function linkText(link: Link): string {
  return isRecordLink(link)
    ? (labelOf(link.collection, link.record) ?? fallbackLabel(link.record))
    : link.url;
}

/**
 * The collections a `link` field allows records of, as declared.
 */
function collectionsOf(field: DashboardField): string[] {
  const collections = field.options?.collections;
  return isArray(collections) ? collections.filter(isString) : [];
}

interface AddressInput {
  element: HTMLElement;
  input: HTMLInputElement;
  problem(): string;
  sync(): void;
}

/**
 * The text input of a `link` field that allows only addresses.
 * Its text reads through `typedHref`, so `example.com` becomes `https://example.com`.
 * Text that reads as no safe address leaves the link as it was: `problem` names it, blur shows it.
 */
function addressInput(
  current: Ref<Link | null>,
  change: (next: Link | null) => void,
  invalid: Ref<string>,
  disabled: boolean,
): AddressInput {
  const t = useT();
  const urlOf = (): string => {
    const link = untracked(() => current.value);
    return isNull(link) || isRecordLink(link) ? '' : link.url;
  };
  const raw = ref(urlOf());
  const read = (): Link | null | undefined => {
    const text = raw.value.trim();
    if (text === '') return null;
    const url = typedHref(text);
    if (isUndefined(url) || !isSafeHref(url)) return undefined;
    return linkOf({ url }, { newTab: untracked(() => current.value?.newTab) });
  };
  const problem = (): string => (isUndefined(read()) ? t('dashboard.link.unsafeURL') : '');
  const element = textInput(raw, {
    disabled: () => disabled,
    placeholder: () => t('dashboard.link.urlPlaceholder'),
  });
  const input = element.querySelector('input') as HTMLInputElement;
  input.addEventListener('input', () => {
    invalid.value = '';
    const next = read();
    change(isUndefined(next) ? untracked(() => current.value) : next);
  });
  input.addEventListener('blur', () => {
    invalid.value = problem();
  });
  return {
    element,
    input,
    problem,
    sync() {
      raw.value = urlOf();
      invalid.value = '';
    },
  };
}

/**
 * The button that opens a link's target in a new tab, or nothing when the target opens nowhere.
 * A record opens at its dashboard page as Edit when the user may update it, and as View otherwise.
 */
function openButton(link: Link): Child {
  const t = useT();
  const href = targetHref(link);
  if (isUndefined(href)) return null;
  if (!isRecordLink(link)) {
    return button(() => t('dashboard.open'), {
      icon: 'external-link',
      iconOnly: true,
      variant: 'outline',
      href,
      target: '_blank',
    });
  }
  const updatable = ref(false);
  const collection = readableCollection(link.collection);
  if (!isUndefined(collection)) {
    void loadVerdicts(collection, [link.record]).then((verdicts) => {
      updatable.value = verdicts.update.has(link.record);
    });
  }
  return () => {
    const label = t(updatable.value ? 'dashboard.edit' : 'dashboard.view');
    return button(() => label, {
      icon: updatable.value ? 'pencil' : 'list-search',
      iconOnly: true,
      variant: 'outline',
      href,
      target: '_blank',
    });
  };
}

registerFieldType('link', linkType);
