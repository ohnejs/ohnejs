import type { Ref } from '../../../utils/reactive/ref.ts';
import type { Child } from '../../render/insert.ts';
import type { DashboardCollection, DashboardField } from '../../runtime/meta-types.ts';
import type { Primitive } from '../../ui/button-group.ts';
import type {
  DynamicSelectChoice,
  DynamicSelectPaginatedChoices,
} from '../../ui/dynamic-select.ts';

import { keywordsCondition } from '../../../utils/condition/keywords-condition.ts';
import { isEmpty } from '../../../utils/is/is-empty.ts';
import { isNull } from '../../../utils/is/is-null.ts';
import { isNullish } from '../../../utils/is/is-nullish.ts';
import { isString } from '../../../utils/is/is-string.ts';
import { isUndefined } from '../../../utils/is/is-undefined.ts';
import { onCleanup } from '../../../utils/reactive/effect-scope.ts';
import { effect } from '../../../utils/reactive/effect.ts';
import { ref } from '../../../utils/reactive/ref.ts';
import { untracked } from '../../../utils/reactive/untracked.ts';
import { recordHref } from '../../../utils/route/record-href.ts';
import { searchTokens } from '../../../utils/search/search-tokens.ts';
import { shortUUID } from '../../../utils/uuid/short-uuid.ts';
import { h } from '../../render/h.ts';
import { api } from '../../runtime/api.ts';
import { useT } from '../../runtime/use-t.ts';
import { loadVerdicts } from '../../runtime/verdicts.ts';
import { button } from '../../ui/button.ts';
import { dynamicSelect } from '../../ui/dynamic-select.ts';
import { icon } from '../../ui/icon.ts';
import { textInput } from '../../ui/text-input.ts';
import { attachTooltip } from '../../ui/tooltip.ts';
import { targetOf } from '../_search.ts';
import { cellEditor } from '../cell-editor.ts';
import { describeControl } from '../field-row.ts';
import { dimMark, type FieldType, registerFieldType } from '../field-type.ts';
import { fallbackLabel, joinLabel, labelOf, seedLabel } from '../labels.ts';
import { pickerTrigger } from '../record-picker.ts';

const PER_PAGE = 50;

/**
 * The async choice resolvers over one relation target, shared by the `record` and `records` controls.
 * Every resolved row seeds the label cache, so table cells render the same label without a fetch.
 */
export interface RecordChoiceSource {
  /**
   * Resolves one page of target choices; each of `keyword`'s `searchTokens` must match a label field.
   * A failed request resolves an empty first page, so the dropdown settles on "no results".
   */
  choicesResolver(page: number, keyword: string): Promise<DynamicSelectPaginatedChoices>;

  /**
   * Resolves the linked record's choice.
   * A deleted or unreadable record resolves a "record not found" choice, never `null`.
   */
  choiceOf(uuid: string): Promise<DynamicSelectChoice>;

  /**
   * Resolves the linked records' choices in the given order, fetching only the unseen `UUID`s.
   * A `UUID` the response omits settles on a "record not found" choice.
   */
  choicesOf(uuids: readonly string[]): Promise<DynamicSelectChoice[]>;
}

/**
 * Creates a `RecordChoiceSource` over `target`, labeling and searching by its `labelFields`.
 * The fetcher is the collections query `POST`, paged by `page`/`perPage` and ordered by the label parts.
 * Resolved choices are kept in a per-source cache, so re-resolving linked values never refetches.
 */
export function recordChoiceSource(target: DashboardCollection): RecordChoiceSource {
  const t = useT();
  const names = target.labelFields;
  const cache = new Map<string, DynamicSelectChoice>();

  const keep = (row: Record<string, unknown>): DynamicSelectChoice => {
    const uuid = String(row.UUID);
    const label = joinLabel(row, target);
    const resolved = label !== '' ? label : fallbackLabel(uuid);
    seedLabel(target.name, uuid, resolved);
    const choice = { value: uuid, label: resolved };
    cache.set(uuid, choice);
    return choice;
  };

  const missing = (uuid: string): DynamicSelectChoice => ({
    value: uuid,
    label: `${t('dashboard.recordNotFound')} (${fallbackLabel(uuid)})`,
  });

  const query = async (
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>[] | undefined> => {
    try {
      const response = await api(`POST /collections/${target.segment}/query`, {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ select: ['UUID', ...names], ...body }),
      });
      if (!response.ok) return undefined;
      return (await response.json()) as Record<string, unknown>[];
    } catch {
      return undefined;
    }
  };

  return {
    async choicesResolver(page, keyword) {
      // Ten tokens over at most ten parts keep the `where` inside the server's condition cap.
      const tokens = searchTokens(keyword);
      try {
        const response = await api(`POST /collections/${target.segment}/query`, {
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            select: ['UUID', ...names],
            order: [...names],
            page,
            perPage: PER_PAGE,
            ...(isEmpty(tokens) ? {} : { where: keywordsCondition(tokens, names) }),
          }),
        });
        if (!response.ok) return emptyPage();
        const data = (await response.json()) as {
          records: Record<string, unknown>[];
          total: number;
          page: number;
          perPage: number;
          lastPage: number;
        };
        return {
          choices: data.records.map(keep),
          currentPage: data.page,
          lastPage: data.lastPage,
          perPage: data.perPage,
          total: data.total,
        };
      } catch {
        return emptyPage();
      }
    },
    async choiceOf(uuid) {
      const kept = cache.get(uuid);
      if (!isUndefined(kept)) return kept;
      const rows = await query({ where: { UUID: uuid }, limit: 1 });
      const row = rows?.[0];
      return isUndefined(row) ? missing(uuid) : keep(row);
    },
    async choicesOf(uuids) {
      const unseen = uuids.filter((uuid) => !cache.has(uuid));
      if (!isEmpty(unseen)) {
        const rows = await query({ where: { UUID: { in: unseen } }, limit: unseen.length });
        for (const row of rows ?? []) keep(row);
      }
      return uuids.map((uuid) => cache.get(uuid) ?? missing(uuid));
    },
  };
}

/**
 * A fresh empty first page, answered when a choices request fails.
 */
function emptyPage(): DynamicSelectPaginatedChoices {
  return { choices: [], currentPage: 1, lastPage: 1, perPage: PER_PAGE, total: 0 };
}

/**
 * The `record` field's dashboard behaviour.
 *
 * Cells display the target's resolved label, falling back to the short `UUID` while it loads.
 * The form control is the async `dynamicSelect` combobox over the target's records.
 * A leading table-overview button opens the record picker over the target's full data table.
 * Beside it sit an open-in-new-tab button and, on a nullable field, a clear button while linked.
 * The inline cell editor is a plain mono `UUID` input; combobox editing lives in the edit popup.
 * The filter compares by identity through the same combobox, with the same picker beside it.
 * When the target is unreadable or has no label field, the mono `UUID` input stands in everywhere.
 */
export const recordType: FieldType = {
  display({ field, value }) {
    return () => {
      const current = value();
      if (isNullish(current)) return dimMark('-');
      const uuid = String(current as string);
      const target = field.target ?? '';
      const resolved = labelOf(target, uuid);
      if (isUndefined(resolved)) {
        return h('span', { class: 'cell-mono cell-dim', title: uuid }, shortUUID(uuid));
      }
      return h('span', { class: 'ohne-truncate', title: uuid }, resolved);
    };
  },
  editor(context) {
    const current = context.value();
    return cellEditor({
      initial: isNullish(current) ? '' : String(current as string),
      mono: true,
      commit: (text) => context.commit(text === '' ? null : text),
      cancel: context.cancel,
    });
  },
  control(context) {
    const target = untracked(() => targetOf(context.field));
    const t = useT();
    const off = context.disabled === true;

    let base = context.initial;
    const model = ref<Primitive>(isString(base) ? base : null);
    const touched = ref(false);
    const routed = ref('');

    const baseUUID = (): string | null => (isString(base) ? base : null);
    const current = (): string | null => (isString(model.value) ? model.value : null);
    const change = (): void => {
      touched.value = true;
      routed.value = '';
      context.onInput();
    };

    let element: Child;
    let focusControl: () => void;
    let sync: (() => void) | undefined;

    if (isUndefined(target) || isEmpty(target.labelFields)) {
      const fallback = fallbackInput(context, model, current, change, () => routed.value, off);
      element = fallback.element;
      focusControl = fallback.focus;
      sync = fallback.sync;
    } else {
      const source = recordChoiceSource(target);
      const select = dynamicSelect(model, {
        disabled: () => off,
        choicesResolver: source.choicesResolver,
        selectedChoiceResolver: (value) =>
          isString(value) ? source.choiceOf(value) : Promise.resolve(null),
        error: () => routed.value !== '',
        name: context.path,
        searchLabel: untracked(() => t('dashboard.searchPlaceholder')),
        noResultsLabel: untracked(() => t('dashboard.noResultsFound')),
        // `onCommit` runs before the select writes the model; writing here lets the history push see it.
        onCommit: (value) => {
          model.value = isString(value) ? value : null;
          change();
        },
      });
      const combobox = select.querySelector<HTMLElement>('[role="combobox"]');
      if (!isNull(combobox)) {
        describeControl(combobox, context.field, context.path, () => routed.value);
      }
      const picker = pickerTrigger({
        field: context.field,
        target,
        values: () => {
          const value = current();
          return isNull(value) ? [] : [value];
        },
        multiple: false,
        disabled: off ? (): boolean => true : undefined,
        onApply: (uuids) => {
          model.value = uuids[0] ?? null;
          change();
        },
      });
      const updatable = ref<ReadonlySet<string>>(new Set());
      effect(() => {
        const uuid = current();
        if (isNull(uuid)) return;
        void loadVerdicts(target, [uuid]).then((verdicts) => {
          // A slower answer for a replaced value must not overwrite the current one's.
          if (untracked(current) === uuid) updatable.value = verdicts.update;
        });
      });
      element = h('div', { class: 'ohne-row' }, picker?.trigger, select, picker?.host, () => {
        const value = current();
        if (isNull(value)) return null;
        const canUpdate = updatable.value.has(value);
        const open = button(icon(canUpdate ? 'pencil' : 'list-search'), {
          variant: 'outline',
          href: recordHref(target, value),
          target: '_blank',
          ariaLabel: t(canUpdate ? 'dashboard.edit' : 'dashboard.view'),
        });
        onCleanup(attachTooltip(open, () => t(canUpdate ? 'dashboard.edit' : 'dashboard.view')));
        if (!context.field.nullable) return open;
        const clear = button(icon('x'), {
          variant: 'outline',
          disabled: off ? (): boolean => true : undefined,
          ariaLabel: t('dashboard.clearSelection'),
          onClick: () => {
            model.value = null;
            change();
          },
        });
        onCleanup(attachTooltip(clear, () => t('dashboard.clearSelection')));
        return [open, clear];
      });
      focusControl = () => combobox?.focus();
    }

    return {
      element,
      read() {
        if (!touched.value && isUndefined(base)) return {};
        if (isNull(current()) && !context.field.nullable) return {};
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
      focus: () => focusControl(),
      revert() {
        model.value = baseUUID();
        touched.value = false;
        routed.value = '';
        sync?.();
      },
      rebase(value) {
        base = value;
        model.value = baseUUID();
        touched.value = false;
        routed.value = '';
        sync?.();
      },
    };
  },
  filter: {
    operators: () => ['eq', 'ne'],
    seed: () => '',
    input(context) {
      const target = untracked(() => targetOf(context.field));
      if (isUndefined(target) || isEmpty(target.labelFields)) {
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
      const t = useT();
      const source = recordChoiceSource(target);
      const bridged: Ref<Primitive> = {
        get value() {
          const current = context.value();
          return current === '' ? null : current;
        },
        set value(next) {
          context.commit(isString(next) ? next : '');
        },
      };
      const picker = pickerTrigger({
        field: context.field,
        target,
        values: () => {
          const current = context.value();
          return isString(current) && current !== '' ? [current] : [];
        },
        multiple: false,
        onApply: (uuids) => context.commit(uuids[0] ?? ''),
      });
      const select = dynamicSelect(bridged, {
        choicesResolver: source.choicesResolver,
        selectedChoiceResolver: (value) =>
          isString(value) && value !== '' ? source.choiceOf(value) : Promise.resolve(null),
        name: context.inputID,
        searchLabel: untracked(() => t('dashboard.searchPlaceholder')),
        noResultsLabel: untracked(() => t('dashboard.noResultsFound')),
      });
      if (isUndefined(picker)) return select;
      return h('div', { class: 'ohne-row' }, picker.trigger, select, picker.host);
    },
  },
};

/**
 * The plain `UUID` input standing in when the combobox cannot search the target.
 */
function fallbackInput(
  context: { field: DashboardField; path: string },
  model: Ref<Primitive>,
  current: () => string | null,
  change: () => void,
  error: () => string,
  disabled: boolean,
): { element: HTMLElement; focus(): void; sync(): void } {
  const raw = ref(untracked(current) ?? '');
  const control = textInput(raw, { error: () => error() !== '', disabled: () => disabled });
  const input = control.querySelector('input') as HTMLInputElement;
  input.classList.add('cell-mono');
  input.addEventListener('input', () => {
    model.value = input.value === '' ? null : input.value;
    change();
  });
  describeControl(input, context.field, context.path, error);
  return {
    element: control,
    focus: () => input.focus(),
    sync() {
      raw.value = current() ?? '';
    },
  };
}

registerFieldType('record', recordType);
