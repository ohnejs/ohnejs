import {
  attachTooltip,
  button,
  card,
  type Child,
  css,
  type DashboardField,
  each,
  type FieldFilter,
  fieldTypeFor,
  type FilterCondition,
  filterFromWhere,
  type FilterGroup,
  filterKey,
  type FilterModel,
  type FilterNode,
  type FilterOperator,
  filterToWhere,
  h,
  icon,
  type IconName,
  popup,
  type Popup,
  type Primitive,
  select,
  type SelectChoice,
  useDashboardLanguage,
  useHotkeys,
  useT,
  when,
} from 'ohne/dashboard';
import {
  computed,
  type ConditionObject,
  effect,
  first,
  isUndefined,
  jsonClone,
  naturalCompare,
  onCleanup,
  type Ref,
  ref,
} from 'ohne/utils';

import { unsavedChanges } from './history.ts';
import { actionButton } from './item-actions.ts';

/**
 * Options for `filterPopup`.
 */
export interface FilterPopupOptions {
  /**
   * The popup title, read reactively when given as a getter.
   */
  title: string | (() => string);

  /**
   * The filterable field candidates, read reactively.
   * The builder keeps the column-backed ones whose storage primitive it can compare.
   */
  fields: () => DashboardField[];

  /**
   * The currently applied `where`, rebuilt into the tree through `filterFromWhere`.
   */
  where: ConditionObject | undefined;

  /**
   * Called with the serialized `where` on Apply, or `undefined` when no conditions are set.
   * The emitted value is the exact `ConditionObject` the body-query endpoint reads; see `filterToWhere`.
   */
  onApply(where: ConditionObject | undefined): void;

  /**
   * Called when the popup asks to close, with its animated close function.
   * The caller awaits it and then disposes the region that created the popup.
   */
  onClose(close: () => Promise<void>): void;

  /**
   * The CSS width of the popup.
   *
   * @default
   * '50rem'
   */
  width?: string;
}

const OPERATOR_LABEL_KEYS = {
  eq: 'dashboard.filter.operator.equals',
  ne: 'dashboard.filter.operator.doesNotEqual',
  lt: 'dashboard.filter.operator.lessThan',
  lte: 'dashboard.filter.operator.lessThanOrEqualTo',
  gt: 'dashboard.filter.operator.greaterThan',
  gte: 'dashboard.filter.operator.greaterThanOrEqualTo',
  startsWith: 'dashboard.filter.operator.startsWith',
  endsWith: 'dashboard.filter.operator.endsWith',
  contains: 'dashboard.filter.operator.contains',
  notContains: 'dashboard.filter.operator.doesNotContain',
  includes: 'dashboard.filter.operator.includes',
  notIncludes: 'dashboard.filter.operator.doesNotInclude',
} as const;

let sequence = 0;

css`
  .o-filter-popup-title {
    font-weight: 500;
  }

  .o-where-filters > * + * {
    margin-top: 0.75rem;
  }

  .o-where-filters-card {
    --ohne-padding-header: 0.5rem;
  }

  /* No drag handle here, so the row meets the body's 0.75rem grid. */
  .o-where-filters-row {
    min-height: 2em;
    padding-left: 0.25rem;
  }

  .o-where-filters :where(.o-where-filters-actions) {
    display: none;
    gap: 0.25rem;
    margin-left: auto;
  }

  :where(.o-where-filters-item:hover, .o-where-filters-item:focus-within)
    > .ohne-card-header
    > .o-where-filters-row
    > .o-where-filters-actions {
    display: flex;
  }

  .o-where-filters-small-button {
    display: none;
  }

  @container (max-width: 480px) {
    .o-where-filters-large-button {
      display: none;
    }

    .o-where-filters-small-button {
      display: inline-flex;
    }
  }

  .o-where-filters-condition {
    width: 100%;
  }

  .o-where-filters-condition-field {
    width: calc(50% - 6.5rem);
  }

  .o-field-filter-operator {
    width: 12rem;
  }

  .o-field-filter-value {
    flex: 1;
  }

  @container (max-width: 640px) {
    .o-where-filters-condition {
      flex-direction: column;
    }

    .o-where-filters-condition > * {
      width: 100%;
    }

    .o-field-filter {
      flex-direction: column;
    }

    .o-field-filter-operator,
    .o-field-filter-value {
      width: 100%;
    }
  }
`;

/**
 * The filter builder popup.
 *
 * Each condition picks a field, an operator valid for its storage primitive, and a typed value input.
 * Condition groups nest with a toggleable and/or relation; the top level carries its own over all members.
 * Apply serializes the tree through `filterToWhere` and hands the result to `onApply`.
 * A dirty tree guards Escape and the overlay click through the `unsavedChanges` prompt.
 * Create it inside a reactive region; dispose the region after `onClose`'s close resolves.
 */
export function filterPopup(options: FilterPopupOptions): Popup {
  const t = useT();
  const id = `o-where-filters-${++sequence}`;
  const version = ref(0);
  const initial: FilterModel = filterFromWhere(options.where);
  const root: FilterGroup = { key: filterKey(), relation: initial.relation, items: initial.items };
  const currentWhere = (): ConditionObject | undefined =>
    filterToWhere({ relation: root.relation, items: root.items });
  const baseline = JSON.stringify(currentWhere() ?? null);
  const dirty = computed(() => {
    void version.value;
    return JSON.stringify(currentWhere() ?? null) !== baseline;
  });

  const commit = (): void => {
    version.value += 1;
  };

  const filterOf = (field: DashboardField): FieldFilter | undefined => fieldTypeFor(field).filter;

  const fieldChoices = (): DashboardField[] =>
    options
      .fields()
      .filter((field) => field.readable && !isUndefined(filterOf(field)))
      .sort((a, b) => naturalCompare(a.label, b.label));

  const fieldByName = (name: string): DashboardField | undefined =>
    fieldChoices().find((field) => field.name === name);

  const seedCondition = (field: DashboardField): FilterCondition | undefined => {
    const filter = filterOf(field);
    if (isUndefined(filter)) return undefined;
    return {
      key: filterKey(),
      field: field.name,
      operator: filter.operators(field)[0] ?? 'eq',
      value: filter.seed(field),
    };
  };

  const newCondition = (): FilterCondition | undefined => {
    const choice = first(fieldChoices());
    return isUndefined(choice) ? undefined : seedCondition(choice);
  };

  const addCondition = (group: FilterGroup): void => {
    const condition = newCondition();
    if (isUndefined(condition)) return;
    group.items.push(condition);
    commit();
  };

  const addGroup = (group: FilterGroup): void => {
    const condition = newCondition();
    if (isUndefined(condition)) return;
    group.items.push({ key: filterKey(), relation: 'or', items: [condition] });
    commit();
  };

  const duplicate = (group: FilterGroup, index: number): void => {
    const node = group.items[index];
    if (isUndefined(node)) return;
    const clone = jsonClone(node);
    rekey(clone);
    group.items.splice(index, 0, clone);
    commit();
  };

  const remove = (group: FilterGroup, index: number): void => {
    group.items.splice(index, 1);
    commit();
  };

  const relationToggle = (relation: () => 'and' | 'or', onToggle: () => void): HTMLElement => {
    const control = button(
      () =>
        h('span', null, () =>
          t(relation() === 'and' ? 'dashboard.filter.and' : 'dashboard.filter.or'),
        ),
      { size: -2, variant: 'secondary', class: 'ohne-uppercase', onClick: onToggle },
    );
    onCleanup(attachTooltip(control, () => t('dashboard.filter.toggleRelation')));
    return control;
  };

  const relationText = (relation: () => 'and' | 'or'): Child =>
    h('span', { class: 'ohne-muted ohne-truncate' }, () =>
      t(relation() === 'and' ? 'dashboard.filter.allMustMatch' : 'dashboard.filter.anyMustMatch'),
    );

  const valueInput = (node: FilterCondition, inputID: string): Child => {
    const field = fieldByName(node.field);
    const filter = isUndefined(field) ? undefined : filterOf(field);
    if (isUndefined(field) || isUndefined(filter)) return null;
    return filter.input({
      field,
      operator: () => {
        void version.value;
        return node.operator;
      },
      value: () => {
        void version.value;
        return node.value;
      },
      set: (next) => {
        node.value = next;
      },
      commit: (next) => {
        if (!isUndefined(next)) node.value = next;
        commit();
      },
      inputID,
      language: () => useDashboardLanguage().value,
    });
  };

  const conditionRow = (group: FilterGroup, node: FilterCondition): Child => {
    const inputID = `${id}-${++sequence}`;
    const fieldModel: Ref<Primitive> = {
      get value() {
        void version.value;
        return node.field;
      },
      set value(next) {
        const field = fieldByName(String(next));
        if (isUndefined(field)) return;
        const filter = filterOf(field);
        if (isUndefined(filter)) return;
        const valid = filter.operators(field);
        const index = group.items.indexOf(node);
        if (index === -1) return;
        group.items[index] = {
          key: filterKey(),
          field: field.name,
          operator: valid.includes(node.operator) ? node.operator : (valid[0] ?? 'eq'),
          value: filter.seed(field),
        };
        commit();
      },
    };
    const operatorModel: Ref<Primitive> = {
      get value() {
        void version.value;
        return node.operator;
      },
      set value(next) {
        node.operator = next as FilterOperator;
        commit();
      },
    };
    return h(
      'div',
      { class: 'o-where-filters-condition ohne-row' },
      h(
        'div',
        { class: 'o-where-filters-condition-field' },
        select(
          fieldModel,
          (): SelectChoice[] =>
            fieldChoices().map((field) => ({ label: field.label, value: field.name })),
          { id: `${inputID}-field`, name: `${inputID}-field` },
        ),
      ),
      h(
        'div',
        { class: 'o-field-filter ohne-row ohne-flex-1' },
        h(
          'div',
          { class: 'o-field-filter-operator' },
          select(
            operatorModel,
            (): SelectChoice[] => {
              const field = fieldByName(node.field);
              const filter = isUndefined(field) ? undefined : filterOf(field);
              if (isUndefined(field) || isUndefined(filter)) return [];
              return filter.operators(field).map((operator) => ({
                label: t(OPERATOR_LABEL_KEYS[operator]),
                value: operator,
              }));
            },
            { id: `${inputID}-operator`, name: `${inputID}-operator` },
          ),
        ),
        h('div', { class: 'o-field-filter-value' }, valueInput(node, `${inputID}-value`)),
      ),
    );
  };

  const smallAddButton = (
    glyph: IconName,
    tooltip: () => string,
    onClick: () => void,
  ): HTMLElement => {
    const control = button(icon(glyph), {
      variant: 'outline',
      class: 'o-where-filters-small-button',
      disabled: () => fieldChoices().length === 0,
      onClick,
    });
    onCleanup(attachTooltip(control, tooltip));
    return control;
  };

  const addButtons = (group: FilterGroup): Child =>
    h(
      'div',
      { class: 'ohne-row' },
      button([icon('plus'), h('span', null, () => t('dashboard.filter.condition'))], {
        variant: 'outline',
        class: 'o-where-filters-large-button',
        disabled: () => fieldChoices().length === 0,
        onClick: () => addCondition(group),
      }),
      smallAddButton(
        'plus',
        () => t('dashboard.filter.addCondition'),
        () => addCondition(group),
      ),
      button([icon('copy-plus'), h('span', null, () => t('dashboard.filter.conditionGroup'))], {
        variant: 'outline',
        class: 'o-where-filters-large-button',
        disabled: () => fieldChoices().length === 0,
        onClick: () => addGroup(group),
      }),
      smallAddButton(
        'copy-plus',
        () => t('dashboard.filter.addConditionGroup'),
        () => addGroup(group),
      ),
    );

  const itemHeader = (group: FilterGroup, node: () => FilterNode, index: () => number): Child =>
    h(
      'div',
      { class: 'ohne-row o-where-filters-row' },
      h(
        'span',
        { class: 'ohne-muted ohne-truncate' },
        () =>
          `${index() + 1}. ${t(
            'items' in node() ? 'dashboard.filter.conditionGroup' : 'dashboard.filter.condition',
          )}`,
      ),
      h(
        'div',
        { class: 'o-where-filters-actions' },
        actionButton(
          'copy',
          () => t('dashboard.filter.duplicate'),
          () => duplicate(group, index()),
        ),
        actionButton(
          'trash',
          () => t('dashboard.delete'),
          () => remove(group, index()),
          { destructiveHover: true },
        ),
      ),
    );

  function groupBody(group: FilterGroup): Child {
    return h(
      'div',
      { class: 'o-where-filters' },
      each(
        () => {
          void version.value;
          return group.items.slice();
        },
        (node) => node.key,
        (node, index) => {
          const current = node();
          const row = card('items' in current ? groupCard(current) : conditionRow(group, current), {
            header: itemHeader(group, node, index),
          });
          row.classList.add('o-where-filters-item');
          return row;
        },
      ),
      addButtons(group),
    );
  }

  function groupCard(group: FilterGroup): Child {
    return card(groupBody(group), {
      header: h(
        'div',
        { class: 'ohne-row' },
        relationToggle(
          () => {
            void version.value;
            return group.relation;
          },
          () => {
            group.relation = group.relation === 'and' ? 'or' : 'and';
            commit();
          },
        ),
        relationText(() => {
          void version.value;
          return group.relation;
        }),
      ),
    });
  }

  const rootHeader = (): Child =>
    h(
      'div',
      { class: 'ohne-row' },
      when(
        () => {
          void version.value;
          return root.items.length > 0;
        },
        () => [
          relationToggle(
            () => {
              void version.value;
              return root.relation;
            },
            () => {
              root.relation = root.relation === 'and' ? 'or' : 'and';
              commit();
            },
          ),
          relationText(() => {
            void version.value;
            return root.relation;
          }),
        ],
        () =>
          h('span', { class: 'ohne-muted ohne-truncate' }, () =>
            t('dashboard.filter.noConditions'),
          ),
      ),
    );

  const guardedClose = async (): Promise<void> => {
    if (!dirty.value || ((await unsavedChanges.prompt?.()) ?? true)) {
      options.onClose(handle.close);
    }
  };

  const apply = (): void => {
    options.onApply(currentWhere());
    options.onClose(handle.close);
  };

  const closeButton = button(icon('x'), {
    size: -2,
    variant: 'ghost',
    class: 'ohne-ml-auto',
    onClick: () => void guardedClose(),
  });
  effect(() => {
    closeButton.title = t('dashboard.close');
  });

  const applyButton = button(() => t('dashboard.apply'), {
    variant: 'outline',
    class: 'ohne-ml-auto',
    onClick: apply,
  });
  effect(() => {
    const changed = dirty.value;
    applyButton.classList.toggle('ohne-button-primary', changed);
    applyButton.classList.toggle('ohne-button-outline', !changed);
  });

  const filtersCard = card(groupBody(root), { header: rootHeader() });
  filtersCard.classList.add('o-where-filters-card');

  const handle = popup(filtersCard, {
    size: -1,
    width: options.width,
    fullHeight: true,
    header: h(
      'div',
      { class: 'ohne-row' },
      h('span', { class: 'o-filter-popup-title' }, options.title),
      closeButton,
    ),
    footer: h('div', { class: 'ohne-justify-between' }, applyButton),
    onClose: () => void guardedClose(),
  });

  const hotkeys = useHotkeys({ allowInOverlays: true, target: () => handle.root, listen: false });
  setTimeout(() => {
    hotkeys.isListening.value = true;
    hotkeys.listen('save', (event) => {
      event.preventDefault();
      apply();
    });
  });

  return handle;
}

/**
 * Fresh reconciliation keys for a duplicated subtree, so it never collides with its source.
 */
function rekey(node: FilterNode): void {
  node.key = filterKey();
  if ('items' in node) {
    for (const child of node.items) rekey(child);
  }
}
