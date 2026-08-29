import {
  attachTooltip,
  button,
  card,
  type Child,
  css,
  type DashboardField,
  each,
  h,
  icon,
  iconGroup,
  type IconName,
  type Primitive,
  select,
  type SelectChoice,
  useT,
  when,
} from 'ohne/dashboard';
import { effect, isUndefined, onCleanup, type Ref, ref, untracked } from 'ohne/utils';

/**
 * Options for `orderBy`.
 */
export interface OrderByOptions {
  /**
   * The current order, read reactively: ohne order strings, a leading `-` meaning descending.
   */
  model: () => readonly string[];

  /**
   * The sortable fields the builder offers, read reactively.
   */
  fields: () => DashboardField[];

  /**
   * Called with the rebuilt order strings after every change.
   */
  onCommit: (order: string[]) => void;
}

interface OrderByItem {
  field: string;
  type: 'text' | 'numeric';
  direction: 'asc' | 'desc';
}

let sequence = 0;

css`
  .o-order-by > * + * {
    margin-top: 0.75rem;
  }

  .o-order-by-item {
    --ohne-padding-header: 0.5rem;
  }

  .o-order-by-row {
    min-height: 2em;
    padding-left: 0.25rem;
  }

  .o-order-by :where(.o-order-by-actions) {
    display: none;
    gap: 0.25rem;
    margin-left: auto;
  }

  :where(.o-order-by-item:hover, .o-order-by-item:focus-within)
    > .ohne-card-header
    > .o-order-by-row
    > .o-order-by-actions {
    display: flex;
  }
`;

/**
 * The sorting rule builder.
 *
 * Each rule is a card: a field select beside the ascending/descending pair.
 * The pair's icons follow the field's storage primitive.
 * Move, add-before, and delete actions reveal on hover or focus.
 * A field appears in one rule at most; taken fields render disabled in the other selects.
 * It emits ohne order strings: `field` ascending, `-field` descending.
 */
export function orderBy(options: OrderByOptions): HTMLElement {
  const t = useT();
  const id = `o-order-by-${++sequence}`;
  const items = ref<OrderByItem[]>([]);

  effect(() => {
    items.value = fromModel(options.model(), options.fields());
  });

  const commit = (next: OrderByItem[]): void => {
    items.value = next;
    options.onCommit(
      next.map((item) => (item.direction === 'desc' ? `-${item.field}` : item.field)),
    );
  };

  const resolveItem = (field: DashboardField): OrderByItem => ({
    field: field.name,
    type: field.logicalType === 'text' ? 'text' : 'numeric',
    direction: 'asc',
  });

  const addColumn = (index?: number): void => {
    const free = options
      .fields()
      .find((field) => items.value.every((item) => item.field !== field.name));
    if (isUndefined(free)) return;
    const next = [...items.value];
    next.splice(index ?? next.length, 0, resolveItem(free));
    commit(next);
  };

  const swap = (index: number, offset: number): void => {
    const next = [...items.value];
    const other = next[index + offset];
    const current = next[index];
    if (isUndefined(other) || isUndefined(current)) return;
    next[index + offset] = current;
    next[index] = other;
    commit(next);
  };

  const actionButton = (
    glyph: IconName,
    tooltip: () => string,
    onClick: () => void,
    extras: { disabled?: () => boolean; destructiveHover?: boolean } = {},
  ): HTMLElement => {
    const control = button(icon(glyph), {
      size: -2,
      variant: 'ghost',
      destructiveHover: extras.destructiveHover,
      disabled: extras.disabled,
      onClick,
    });
    onCleanup(attachTooltip(control, tooltip));
    return control;
  };

  const header = (item: () => OrderByItem, index: () => number): Child =>
    h(
      'div',
      { class: 'ohne-row o-order-by-row' },
      h(
        'span',
        { class: 'ohne-muted ohne-truncate' },
        () => `${index() + 1}. ${t('dashboard.sort.title')}`,
      ),
      h(
        'div',
        { class: 'o-order-by-actions' },
        when(
          () => items.value.length > 1,
          () => [
            actionButton(
              'chevron-up',
              () => t('dashboard.sort.moveUp'),
              () => swap(index(), -1),
              {
                disabled: () => index() === 0,
              },
            ),
            actionButton(
              'chevron-down',
              () => t('dashboard.sort.moveDown'),
              () => swap(index(), 1),
              { disabled: () => index() === items.value.length - 1 },
            ),
          ],
        ),
        actionButton(
          'arrow-bar-to-up',
          () => t('dashboard.sort.addBefore'),
          () => addColumn(index()),
          {
            disabled: () => items.value.length >= options.fields().length,
          },
        ),
        actionButton(
          'trash',
          () => t('dashboard.delete'),
          () => {
            const next = [...items.value];
            next.splice(index(), 1);
            commit(next);
          },
          { destructiveHover: true },
        ),
      ),
    );

  const fieldSelect = (item: () => OrderByItem): HTMLElement => {
    const model: Ref<Primitive> = {
      get value() {
        return item().field;
      },
      set value(next) {
        const field = options.fields().find((candidate) => candidate.name === String(next));
        if (isUndefined(field)) return;
        const previous = item().field;
        commit(
          items.value.map((candidate) =>
            candidate.field === previous ? resolveItem(field) : candidate,
          ),
        );
      },
    };
    return select(
      model,
      (): SelectChoice[] =>
        options
          .fields()
          .map((field) =>
            field.name === item().field ||
            items.value.every((candidate) => candidate.field !== field.name)
              ? { label: field.label, value: field.name }
              : { label: field.label, value: field.name, disabled: true },
          ),
      // Untracked: the id is static, and a tracked read would rebuild the row on every toggle.
      { id: `${id}-${untracked(() => item().field)}-field`, name: id },
    );
  };

  const directionGroup = (item: () => OrderByItem): HTMLElement => {
    const model: Ref<Primitive> = {
      get value() {
        return item().direction;
      },
      set value(next) {
        commit(
          items.value.map((candidate) =>
            candidate.field === item().field
              ? { ...candidate, direction: next === 'desc' ? 'desc' : 'asc' }
              : candidate,
          ),
        );
      },
    };
    return iconGroup(model, {
      choices: () => [
        {
          value: 'asc',
          icon: item().type === 'text' ? 'sort-ascending-letters' : 'sort-ascending-numbers',
          title: t('dashboard.sort.ascending'),
        },
        {
          value: 'desc',
          icon: item().type === 'text' ? 'sort-descending-letters' : 'sort-descending-numbers',
          title: t('dashboard.sort.descending'),
        },
      ],
      variant: 'accent',
      showTooltips: true,
      id: `${id}-direction`,
      name: `${id}-direction`,
    });
  };

  return h(
    'div',
    { class: 'o-order-by' },
    each(
      () => items.value,
      (item) => item.field,
      (item, index) => {
        const row = card(h('div', { class: 'ohne-row' }, fieldSelect(item), directionGroup(item)), {
          header: header(item, index),
        });
        row.classList.add('o-order-by-item');
        return row;
      },
    ),
    when(
      () => items.value.length === 0,
      () => h('div', { class: 'ohne-muted ohne-truncate' }, () => t('dashboard.sort.none')),
    ),
    button([icon('plus'), h('span', null, () => t('dashboard.sort.title'))], {
      variant: 'outline',
      disabled: () => options.fields().length === items.value.length,
      onClick: () => addColumn(),
    }),
  );
}

/**
 * The internal rule list rebuilt from order strings, unknown fields dropped.
 */
function fromModel(order: readonly string[], fields: readonly DashboardField[]): OrderByItem[] {
  const items: OrderByItem[] = [];
  for (const entry of order) {
    const descending = entry.startsWith('-');
    const name = descending ? entry.slice(1) : entry;
    const field = fields.find((candidate) => candidate.name === name);
    if (isUndefined(field)) continue;
    items.push({
      field: name,
      type: field.logicalType === 'text' ? 'text' : 'numeric',
      direction: descending ? 'desc' : 'asc',
    });
  }
  return items;
}
