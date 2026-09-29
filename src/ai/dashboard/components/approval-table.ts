import { loadPage } from 'app/components/collection-table-data.ts';
import {
  button,
  type Child,
  css,
  type DashboardCollection,
  dimMark,
  fallbackLabel,
  h,
  icon,
  labelOf,
  loadVerdicts,
  seedLabel,
  table,
  tableColumn,
  textArea,
  when,
} from 'ohnejs/dashboard';
import {
  chunk,
  isPlainObject,
  isString,
  isUndefined,
  parseRouteID,
  ref,
  untracked,
} from 'ohnejs/utils';

import type { AITranslate } from './_ai-messages.ts';
import type { Approval } from './send-queue.ts';
import type { Proposal, TurnBatch } from './turn-store.ts';

import { useAIT } from './_ai-messages.ts';
import { collectionOfRoute } from './_ai-meta.ts';
import { describeWhere, expandSet } from './expand-set.ts';

/**
 * Options for `approvalTable`.
 */
export interface ApprovalTableOptions {
  /**
   * Called with one approval per proposal once the person approves.
   */
  onApprove(approvals: Approval[]): void;

  /**
   * Called with the person's note once they decline.
   */
  onDecline(note?: string): void;
}

/**
 * What a write proposal does, which names its verdict and its words.
 */
type Verb = 'create' | 'update' | 'delete' | 'copyTranslations' | 'deleteTranslations' | 'request';

/**
 * One row of the table: a record a write reaches, or the one record a create makes.
 */
interface ApprovalRow {
  id: string;
  proposal: number;
  verb: Verb;
  collection: DashboardCollection | null;
  UUID: string | null;
  mine: boolean;
  changes: Change[];
}

/**
 * One field a write sets, with the value it holds now when the person may read it.
 */
interface Change {
  label: string;
  current: unknown;
  known: boolean;
  proposed: unknown;
}

type Armed = 'selected' | 'all' | null;

/**
 * How many records one read of current values asks for.
 */
const PAGE = 50;

const VERDICT_OF: Readonly<Record<Verb, 'update' | 'delete' | 'deleteTranslation'>> = {
  create: 'update',
  update: 'update',
  delete: 'delete',
  copyTranslations: 'update',
  deleteTranslations: 'deleteTranslation',
  request: 'update',
};

css`
  .o-approval {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 0.75rem;
    border: 1px solid hsl(var(--ohne-border));
    border-radius: var(--ohne-radius);
  }

  .o-approval-destructive {
    border-color: hsl(var(--ohne-destructive) / 0.5);
  }

  .o-approval-header {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.875rem;
    font-weight: 500;
  }

  .o-approval-filter {
    color: hsl(var(--ohne-muted-foreground));
    font-weight: 400;
  }

  .o-approval-rows {
    max-height: 20rem;
    overflow: auto;
    font-size: 0.8125rem;
  }

  .o-approval-foreign {
    opacity: 0.5;
  }

  .o-approval-change {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.125rem 0.375rem;
  }

  .o-approval-change > svg {
    align-self: center;
    flex-shrink: 0;
    font-size: 0.875rem;
  }

  .o-approval-field {
    font-weight: 500;
  }

  .o-approval-value {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .o-approval-proposed {
    color: hsl(var(--ohne-foreground));
  }

  .o-approval-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .o-approval-actions > :last-child {
    margin-left: auto;
  }
`;

/**
 * The approval table of one batch: every write it proposes, one row per record it reaches.
 * A write by set expands into its rows; a row outside the person's reach is greyed and never sent.
 * An update shows each field's current value beside the proposed one, when the person may read it.
 * The person approves the selected rows, every row, or declines with a note; a destructive batch asks twice.
 * A read in the batch runs whatever the person decides, since reads never ask.
 */
export function approvalTable(batch: () => TurnBatch, options: ApprovalTableOptions): Child {
  const t = useAIT();
  const current = untracked(batch);
  const destructive = current.kind === 'destructive';
  const writes = current.proposals
    .map((proposal, index) => ({ proposal, index }))
    .filter(({ proposal }) => proposal.tier !== 'read');
  const rows = ref<ApprovalRow[] | null>(null);
  const selected = ref<Record<string, boolean>>({});
  const note = ref('');
  const armed = ref<Armed>(null);
  void loadRows(writes).then((loaded) => {
    rows.value = loaded;
  });

  const rowOf = (id: number | string): ApprovalRow | undefined =>
    (rows.value ?? []).find((row) => row.id === id);
  const mine = (): ApprovalRow[] => (rows.value ?? []).filter((row) => row.mine);
  const chosen = (): ApprovalRow[] => mine().filter((row) => selected.value[row.id] === true);
  const selectAllState = (): boolean | 'indeterminate' => {
    const count = chosen().length;
    return count === 0 ? false : count === mine().length ? true : 'indeterminate';
  };

  const approve = (picked: ApprovalRow[]): void => {
    options.onApprove(
      current.proposals.map((proposal, index) => {
        if (proposal.tier === 'read') return { send: true };
        const own = picked.filter((row) => row.proposal === index);
        if (own.length === 0) return { send: false };
        if (isUndefined(proposal.where)) return { send: true };
        return { send: true, UUIDs: own.map((row) => row.UUID).filter(isString) };
      }),
    );
  };
  const act = (which: 'selected' | 'all'): void => {
    if (destructive && untracked(() => armed.value) !== which) {
      armed.value = which;
      return;
    }
    approve(which === 'all' ? untracked(mine) : untracked(chosen));
  };
  const label = (which: 'selected' | 'all'): string =>
    armed.value === which
      ? t('ai.dashboard.batch.confirm')
      : t(which === 'all' ? 'ai.dashboard.batch.approveAll' : 'ai.dashboard.batch.approveSelected');

  const columns = {
    record: tableColumn<string>({ label: t('ai.dashboard.batch.record'), width: '12rem' }),
    action: tableColumn<string>({ label: t('ai.dashboard.batch.action'), width: '7rem' }),
    changes: tableColumn<Change[]>({ label: t('ai.dashboard.batch.changes') }),
  };

  const grid = table({
    columns,
    data: () => rows.value ?? [],
    selectable: () => true,
    rowSelectable: (row) => rowOf(row.id)?.mine === true,
    selected,
    selectAllState,
    onSelectAll: (value) => {
      selected.value = Object.fromEntries(mine().map((row) => [row.id, value]));
    },
    labels: () => ({ noData: t('ai.dashboard.batch.noRows') }),
    cell: ({ row, key }) => {
      const entry = rowOf(row.id);
      if (isUndefined(entry)) return null;
      const foreign = entry.mine ? '' : ' o-approval-foreign';
      if (key === 'record')
        return h('div', { class: `ohne-truncate${foreign}` }, recordName(entry, t));
      if (key === 'action')
        return h('div', { class: foreign }, t(`ai.dashboard.batch.verb.${entry.verb}`));
      if (!entry.mine) return h('div', { class: 'ohne-muted' }, t('ai.dashboard.batch.notYours'));
      return h(
        'div',
        null,
        entry.changes.length === 0 ? dimMark('-') : entry.changes.map(changeLine),
      );
    },
    size: -1,
  });

  return h(
    'div',
    { class: `o-approval${destructive ? ' o-approval-destructive' : ''}` },
    h(
      'div',
      { class: 'o-approval-header' },
      writes.map(({ proposal, index }) => headerLine(proposal, index, rows, t)),
    ),
    when(
      () => rows.value !== null,
      () => h('div', { class: 'o-approval-rows' }, grid.root),
      () => h('div', { class: 'ohne-muted' }, () => t('ai.dashboard.batch.loading')),
    ),
    textArea(note, { placeholder: () => t('ai.dashboard.batch.note'), rows: 1, size: -1 }),
    h(
      'div',
      { class: 'o-approval-actions' },
      button(() => label('selected'), {
        variant: destructive ? 'destructive' : 'primary',
        size: -1,
        disabled: () => chosen().length === 0,
        onClick: () => act('selected'),
      }),
      button(() => label('all'), {
        variant: destructive ? 'destructive' : 'secondary',
        size: -1,
        disabled: () => mine().length === 0,
        onClick: () => act('all'),
      }),
      button(() => t('ai.dashboard.batch.decline'), {
        variant: 'outline',
        size: -1,
        onClick: () => options.onDecline(untracked(() => note.value)),
      }),
    ),
  );
}

/**
 * The header line of one write: what it does to how many records of which collection.
 * A write by set adds its filter in words.
 */
function headerLine(
  proposal: Proposal,
  index: number,
  rows: { value: ApprovalRow[] | null },
  t: AITranslate,
): Child {
  const collection = collectionOfRoute(proposal.route);
  const verb = verbOf(proposal);
  const locale = proposal.query?.locale;
  const count = (): number => (rows.value ?? []).filter((row) => row.proposal === index).length;
  const words = (): string => {
    if (isUndefined(collection)) {
      return t('ai.dashboard.batch.request', { route: proposal.route }).replaceAll('`', '');
    }
    const head = t(`ai.dashboard.batch.${verb}`, { count: count(), collection: collection.label });
    return isString(locale) ? `${head} ${t('ai.dashboard.batch.locale', { locale })}` : head;
  };
  const filter = (): string => {
    if (isUndefined(proposal.where) || isUndefined(collection)) return '';
    const described = describeWhere(proposal.where, {
      field: (name) => collection.fields.find((field) => field.name === name)?.label ?? name,
      t: (key, params) => t(key as `ai.${string}`, params),
    });
    return described === ''
      ? ''
      : t('ai.dashboard.batch.every', { filter: described }).replaceAll('`', '');
  };
  return h(
    'div',
    null,
    h('span', null, words),
    when(
      () => filter() !== '',
      () => h('span', { class: 'o-approval-filter' }, () => `: ${filter()}`),
    ),
  );
}

/**
 * The rows of every write: a write by set expanded, a record named, or the record a create makes.
 * An update then reads the current values of the fields it sets, one page of records at a time.
 */
async function loadRows(
  writes: readonly { proposal: Proposal; index: number }[],
): Promise<ApprovalRow[]> {
  const rows: ApprovalRow[] = [];
  for (const { proposal, index } of writes) {
    const verb = verbOf(proposal);
    const collection = collectionOfRoute(proposal.route) ?? null;
    const locale = localeOf(proposal);
    const base = { proposal: index, verb, collection, changes: [] as Change[] };
    if (
      collection === null ||
      (isUndefined(proposal.where) && isUndefined(proposal.params?.uuid))
    ) {
      rows.push({
        ...base,
        id: `${index}`,
        UUID: null,
        mine: true,
        changes: proposed(proposal, collection),
      });
      continue;
    }
    const operation = VERDICT_OF[verb];
    const own: ApprovalRow[] = [];
    if (!isUndefined(proposal.where)) {
      const expanded = await expandSet(proposal, collection, {
        page: (body) => loadPage(collection.segment, body),
        verdict: async (UUIDs) => (await loadVerdicts(collection, UUIDs, locale))[operation],
      });
      for (const row of expanded) {
        if (row.label !== '') seedLabel(collection.name, row.UUID, row.label);
        own.push({ ...base, id: `${index}:${row.UUID}`, UUID: row.UUID, mine: row.mine });
      }
    } else {
      const uuid = proposal.params?.uuid as string;
      const verdicts = await loadVerdicts(collection, [uuid], locale);
      own.push({
        ...base,
        id: `${index}:${uuid}`,
        UUID: uuid,
        mine: verdicts[operation].has(uuid),
      });
    }
    if (verb === 'update') await fillChanges(own, proposal, collection, locale);
    rows.push(...own);
  }
  return rows;
}

/**
 * Reads the current values of the fields `proposal` sets for `rows`, and writes each row's changes.
 * A field the person cannot read shows its proposed value alone.
 */
async function fillChanges(
  rows: ApprovalRow[],
  proposal: Proposal,
  collection: DashboardCollection,
  locale: string | undefined,
): Promise<void> {
  const keys = Object.keys(proposal.body ?? {});
  const readable = keys.filter((key) =>
    collection.fields.some((field) => field.name === key && field.readable),
  );
  const values = new Map<string, Record<string, unknown>>();
  const uuids = rows.map((row) => row.UUID).filter(isString);
  for (const part of chunk(uuids, PAGE)) {
    const page = await loadPage(collection.segment, {
      where: { UUID: { in: part } },
      select: ['UUID', ...readable],
      page: 1,
      perPage: PAGE,
      ...(isUndefined(locale) ? {} : { locale }),
    });
    for (const record of page?.records ?? []) {
      if (isString(record.UUID)) values.set(record.UUID, record);
    }
  }
  for (const row of rows) {
    const record = row.UUID === null ? undefined : values.get(row.UUID);
    row.changes = keys.map((key) => ({
      label: fieldLabel(collection, key),
      current: record?.[key],
      known: !isUndefined(record) && readable.includes(key),
      proposed: proposal.body?.[key],
    }));
  }
}

/**
 * The changes of a write without a record to compare against: each field's proposed value alone.
 */
function proposed(proposal: Proposal, collection: DashboardCollection | null): Change[] {
  return Object.entries(proposal.body ?? {}).map(([key, value]) => ({
    label: collection === null ? key : fieldLabel(collection, key),
    current: undefined,
    known: false,
    proposed: value,
  }));
}

/**
 * One field's line: its label, the current value and an arrow when known, then the proposed value.
 */
function changeLine(change: Change): HTMLElement {
  return h(
    'div',
    { class: 'o-approval-change' },
    h('span', { class: 'o-approval-field' }, change.label),
    change.known
      ? [h('span', { class: 'o-approval-value' }, formatValue(change.current)), icon('arrow-right')]
      : null,
    h('span', { class: 'o-approval-value o-approval-proposed' }, formatValue(change.proposed)),
  );
}

/**
 * The name a row shows: the record's label, or what a create or an app request is.
 */
function recordName(row: ApprovalRow, t: AITranslate): Child {
  if (row.collection === null) return dimMark('-');
  const { name, segment } = row.collection;
  if (row.UUID === null) return dimMark(t('ai.dashboard.batch.newRecord'));
  const uuid = row.UUID;
  return button(() => labelOf(name, uuid) ?? fallbackLabel(uuid), {
    href: `/collections/${segment}/${uuid}`,
    target: '_blank',
    variant: 'ghost',
    size: -2,
  });
}

/**
 * A value as the table shows it: text as is, an empty one as a dash, anything else as JSON.
 */
function formatValue(value: unknown): Child {
  if (isUndefined(value) || value === null || value === '') return dimMark('-');
  if (isString(value)) return value;
  return isPlainObject(value) || Array.isArray(value) ? JSON.stringify(value) : String(value);
}

/**
 * The label of a field of `collection`, or the name itself when it has none.
 */
function fieldLabel(collection: DashboardCollection, name: string): string {
  return collection.fields.find((field) => field.name === name)?.label ?? name;
}

/**
 * The locale a proposal writes at, when it names one.
 */
function localeOf(proposal: Proposal): string | undefined {
  const locale = proposal.query?.locale;
  return isString(locale) ? locale : undefined;
}

/**
 * What a write proposal does, read off its route.
 */
function verbOf(proposal: Proposal): Verb {
  const { method, path } = parseRouteID(proposal.route);
  if (!path.startsWith('/collections/')) return 'request';
  if (path.endsWith('/translations/copy')) return 'copyTranslations';
  if (path.endsWith('/translations')) return 'deleteTranslations';
  if (method === 'DELETE') return 'delete';
  return method === 'PATCH' ? 'update' : 'create';
}
