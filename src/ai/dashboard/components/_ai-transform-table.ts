import {
  alert,
  api,
  button,
  type Child,
  css,
  type DashboardCollection,
  dimMark,
  h,
  icon,
  joinLabel,
  type Primitive,
  seedLabel,
  select,
  table,
  tableColumn,
  textArea,
  when,
} from 'ohnejs/dashboard';
import {
  hasKey,
  isArray,
  isEmpty,
  isNull,
  isNumber,
  isPlainObject,
  isString,
  isUndefined,
  parseSSE,
  type Ref,
  ref,
  type SSEMessage,
  untracked,
} from 'ohnejs/utils';

import type { AITranslate } from './_ai-messages.ts';
import type { Approval } from './send-queue.ts';
import type { Proposal } from './turn-store.ts';

import { useAIT } from './_ai-messages.ts';
import { aiMeta, collectionOfRoute } from './_ai-meta.ts';
import { currentModel } from './_ai-model-pick.ts';
import { spinner } from './_ai-spinner.ts';
import { recordLink } from './_record-link.ts';
import { eventPayload } from './turn-store.ts';

/**
 * Where a transform table belongs.
 */
export interface TransformTableOptions {
  /**
   * The turn's id.
   */
  turn: string;

  /**
   * The pending batch's id.
   */
  batch: string;

  /**
   * The proposal's index in the batch.
   */
  index: number;

  /**
   * The model the batch pins every transform to, when its flow node names one.
   */
  pinned?: string;
}

/**
 * A mounted transform table: its root, and what the person has approved in it.
 */
export interface TransformTable {
  /**
   * The root element to insert into the approval card.
   */
  root: HTMLElement;

  /**
   * How many changed records are checked; none while the run still streams.
   * Reactive.
   */
  chosen(): number;

  /**
   * How many records the model changed, checked or not; none while the run still streams.
   * Reactive.
   */
  mine(): number;

  /**
   * Whether the run still streams, so nothing of it can be approved yet.
   * Reactive.
   */
  busy(): boolean;

  /**
   * The approval of the proposal as the table stands: every changed record, or the checked ones.
   * Each carries the fields whose edited value differs from the current one; a record with none is left out.
   * A record lacking the locale carries every field, since its update creates the translation.
   * Nothing to send is a decline.
   */
  approval(all: boolean): Approval;

  /**
   * Ends the run if it still streams, so a declined transform spends nothing more.
   */
  stop(): void;
}

/**
 * One record the model rewrote, with the person's edits.
 */
interface TransformRow {
  id: string;
  UUID: string;
  source: Record<string, string | null>;
  edits: Record<string, Ref<string>>;
  fallback: boolean;
}

/**
 * A run's standing: streaming, done, or failed with its reason.
 */
type Standing = 'streaming' | 'done' | { failed: string };

/**
 * One transform run and everything it streamed, kept across remounts so a run is never paid for twice.
 */
interface TransformState {
  rows: Ref<TransformRow[]>;
  selected: Ref<Record<string, boolean>>;
  skipped: Ref<Record<string, number>>;
  matched: Ref<number>;
  reached: Ref<number>;
  standing: Ref<Standing>;
  model: Ref<Primitive>;
  locale: string | undefined;
  started: boolean;
  ticket: symbol | null;
  controller: AbortController | null;
}

/**
 * The reason a refused transform request answers, by its status; any other status is an internal failure.
 */
const REASONS: Readonly<Record<number, string>> = {
  401: 'signedOut',
  403: 'forbidden',
  404: 'off',
  409: 'turnGone',
  429: 'limit',
  503: 'unavailable',
};

const runs = new Map<string, TransformState>();

/**
 * The run every new one waits behind, since the server streams only a couple of runs per person at once.
 */
let lane: Promise<void> = Promise.resolve();

css`
  .o-transform {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .o-transform-instruction {
    color: hsl(var(--ohne-muted-foreground));
    font-weight: 400;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .o-transform-line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.375rem;
    font-size: calc(1em - 0.0625rem);
    color: hsl(var(--ohne-muted-foreground));
  }

  .o-transform-line > svg {
    flex-shrink: 0;
    font-size: 1rem;
  }

  .o-transform-model {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .o-transform-model > :first-child {
    flex-shrink: 0;
    color: hsl(var(--ohne-muted-foreground));
  }

  .o-transform-model > .ohne-select-wrapper {
    flex: 0 1 12rem;
    min-width: 0;
  }

  .o-transform-rows {
    max-height: 24rem;
    overflow: auto;
  }

  .o-transform-cell {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .o-transform-current {
    color: hsl(var(--ohne-muted-foreground));
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
`;

/**
 * The table of one transform proposal: every record the model rewrote, current value beside the proposed one.
 * The run starts on the first mount and streams into module state, so closing the palette loses nothing.
 * Each proposed cell is editable, and what the person types is what the approval sends.
 * A record the model left as it was is unchecked and never sent; a changed one starts checked.
 * Without a transform model pinned by the app or the flow node, a picker offers each model that sees values.
 * Retry reruns the transform on the picked one.
 * The records the server skipped are counted by reason under the rows, as are the ones past the limit.
 */
export function transformTable(proposal: Proposal, options: TransformTableOptions): TransformTable {
  const t = useAIT();
  const collection = collectionOfRoute(proposal.route) ?? null;
  const fields = proposal.transform?.fields ?? [];
  const pinned = options.pinned ?? untracked(aiMeta)?.transformModel;
  const locale = proposal.query?.locale;
  const state = stateOf(options, pinned, isString(locale) ? locale : undefined);
  const { rows, selected, skipped, matched, reached, standing } = state;
  if (!state.started) queue(state, options, pinned, collection);

  const changed = (row: TransformRow): Record<string, unknown> => {
    const body: Record<string, unknown> = {};
    for (const name of fields) {
      const value = valueOf(collection, name, row.edits[name].value);
      if (value !== row.source[name]) body[name] = value;
    }
    if (!row.fallback || isEmpty(body)) return body;
    return Object.fromEntries(
      fields.map((name) => [name, valueOf(collection, name, row.edits[name].value)]),
    );
  };
  const mine = (): TransformRow[] => rows.value.filter((row) => !isEmpty(changed(row)));
  const chosen = (): TransformRow[] => mine().filter((row) => selected.value[row.id] === true);
  const selectAllState = (): boolean | 'indeterminate' => {
    const count = chosen().length;
    return count === 0 ? false : count === mine().length ? true : 'indeterminate';
  };

  const columns = {
    record: tableColumn<string>({ label: t('ai.dashboard.batch.record'), width: '10rem' }),
    ...Object.fromEntries(
      fields.map((name) => [name, tableColumn<string>({ label: fieldLabel(collection, name) })]),
    ),
  };
  const grid = table({
    columns,
    data: () => rows.value,
    selectable: () => true,
    rowSelectable: (row) => !isEmpty(changed(rowOf(row.id) as TransformRow)),
    selected,
    selectAllState,
    onSelectAll: (value) => {
      selected.value = Object.fromEntries(mine().map((row) => [row.id, value]));
    },
    labels: () => ({ noData: t('ai.dashboard.transform.nothing') }),
    cell: ({ row, key }) => {
      const entry = rowOf(row.id);
      if (isUndefined(entry)) return null;
      if (key === 'record') return recordCell(entry, collection, changed, t);
      const name = String(key);
      return h(
        'div',
        { class: 'o-transform-cell' },
        h('div', { class: 'o-transform-current' }, formatValue(entry.source[name])),
        textArea(entry.edits[name], { size: -1, rows: 1 }),
      );
    },
    size: -1,
  });
  const rowOf = (id: number | string): TransformRow | undefined =>
    rows.value.find((row) => row.id === id);

  const header = (): string => {
    const count = reached.value;
    const head = t('ai.dashboard.transform.header', {
      count,
      collection: collection?.label ?? proposal.route,
    });
    return isString(locale) ? `${head} ${t('ai.dashboard.batch.locale', { locale })}` : head;
  };

  const root = h(
    'div',
    { class: 'o-transform' },
    h(
      'div',
      { class: 'o-approval-header' },
      h('span', null, header),
      h('div', { class: 'o-transform-instruction' }, proposal.transform?.instruction ?? ''),
    ),
    when(
      () => isUndefined(pinned),
      () => modelRow(state, options, collection, t),
    ),
    h('div', { class: 'o-transform-line' }, () => standingLine(state, t)),
    when(
      () => rows.value.length > 0,
      () => h('div', { class: 'o-transform-rows' }, grid.root),
    ),
    when(
      () => Object.keys(skipped.value).length > 0,
      () =>
        h('div', { class: 'o-transform-line' }, icon('circle-off'), () =>
          skippedLine(skipped.value, t),
        ),
    ),
    when(
      () => standing.value === 'done' && reached.value === 0 && isEmpty(skipped.value),
      () =>
        h('div', { class: 'o-transform-line' }, icon('circle-off'), () =>
          t('ai.dashboard.transform.nothing'),
        ),
    ),
    when(
      () => standing.value === 'done' && matched.value > reached.value,
      () =>
        h('div', { class: 'o-transform-line' }, icon('circle-off'), () =>
          t('ai.dashboard.transform.unreached', { count: matched.value - reached.value }),
        ),
    ),
  );

  const busy = (): boolean => standing.value === 'streaming';
  return {
    root,
    chosen: () => (busy() ? 0 : chosen().length),
    mine: () => (busy() ? 0 : mine().length),
    busy,
    stop: () => {
      if (!untracked(busy)) return;
      state.ticket = null;
      state.controller?.abort();
      state.controller = null;
      standing.value = 'done';
    },
    approval: (all) => {
      const picked = untracked(all ? mine : chosen);
      const records = picked.map((row) => ({ UUID: row.UUID, body: changed(row) }));
      if (isEmpty(records)) return { send: false };
      const counts = untracked(() => ({ matched: matched.value, reached: reached.value }));
      return { send: true, records, counts };
    },
  };
}

/**
 * The state of the run for `options` at `locale`, created idle when none exists.
 * Runs of other turns are dropped.
 */
function stateOf(
  options: TransformTableOptions,
  pinned: string | undefined,
  locale: string | undefined,
): TransformState {
  const key = `${options.turn}:${options.batch}:${options.index}`;
  for (const other of runs.keys()) {
    if (!other.startsWith(`${options.turn}:`)) runs.delete(other);
  }
  let state = runs.get(key);
  if (isUndefined(state)) {
    state = {
      rows: ref([]),
      selected: ref({}),
      skipped: ref({}),
      matched: ref(0),
      reached: ref(0),
      standing: ref('done'),
      model: ref(pinned ?? firstTransformModel() ?? null),
      locale,
      started: false,
      ticket: null,
      controller: null,
    };
    runs.set(key, state);
  }
  return state;
}

/**
 * The model a transform runs on by default: the turn's model when it may see values, else the first that may.
 */
function firstTransformModel(): string | undefined {
  const models = untracked(aiMeta)?.transformModels ?? [];
  const turn = untracked(currentModel);
  return !isUndefined(turn) && models.includes(turn) ? turn : models[0];
}

/**
 * Starts the transform once the runs before it are done, showing it as working meanwhile.
 * A run stopped while it waits never starts.
 */
function queue(
  state: TransformState,
  options: TransformTableOptions,
  pinned: string | undefined,
  collection: DashboardCollection | null,
): void {
  const ticket = Symbol('run');
  state.started = true;
  state.ticket = ticket;
  state.standing.value = 'streaming';
  lane = lane.then(() =>
    state.ticket === ticket ? run(state, options, pinned, collection) : undefined,
  );
}

/**
 * Runs the transform on the state's model, replacing whatever an earlier run streamed.
 * A run already streaming is aborted first, and only the newest run writes the standing.
 */
async function run(
  state: TransformState,
  options: TransformTableOptions,
  pinned: string | undefined,
  collection: DashboardCollection | null,
): Promise<void> {
  const { rows, selected, skipped, matched, reached, standing, model } = state;
  state.started = true;
  state.controller?.abort();
  const controller = new AbortController();
  state.controller = controller;
  rows.value = [];
  selected.value = {};
  skipped.value = {};
  matched.value = 0;
  reached.value = 0;
  const picked = untracked(() => model.value);
  if (isUndefined(pinned) && !isString(picked)) {
    standing.value = { failed: 'noModel' };
    return;
  }
  standing.value = 'streaming';
  let response: Response;
  try {
    response = await api(`POST /ai/turns/${options.turn}/transform`, {
      signal: controller.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        batch: options.batch,
        proposal: options.index,
        ...(isUndefined(pinned) ? { model: picked } : {}),
      }),
    });
  } catch {
    if (state.controller === controller) standing.value = { failed: 'network' };
    return;
  }
  if (!response.ok || isNull(response.body)) {
    const failed = await refusalOf(response);
    if (state.controller === controller) standing.value = { failed };
    return;
  }
  try {
    for await (const message of parseSSE(response.body)) {
      if (state.controller !== controller) return;
      apply(state, message, collection);
    }
  } catch {
    if (state.controller === controller) standing.value = { failed: 'network' };
    return;
  }
  if (state.controller === controller && standing.value === 'streaming') {
    standing.value = { failed: 'network' };
  }
}

/**
 * Applies one event of the transform stream to its state.
 */
function apply(
  state: TransformState,
  message: SSEMessage,
  collection: DashboardCollection | null,
): void {
  const data = eventPayload(message.data);
  switch (message.event) {
    case 'start':
      if (isNumber(data.matched)) state.matched.value = data.matched;
      if (isNumber(data.reached)) state.reached.value = data.reached;
      return;
    case 'records': {
      if (!isArray(data.records)) return;
      const added = data.records.filter(isPlainObject).flatMap((record) => {
        const row = rowFrom(record);
        return isUndefined(row) ? [] : [row];
      });
      for (const row of added) {
        if (!isNull(collection)) seedFrom(row, collection, state.locale);
        if (differs(row)) state.selected.value = { ...state.selected.value, [row.id]: true };
      }
      state.rows.value = [...state.rows.value, ...added];
      return;
    }
    case 'skipped': {
      if (!isArray(data.skipped)) return;
      const counts = { ...state.skipped.value };
      for (const entry of data.skipped) {
        if (!isPlainObject(entry) || !isString(entry.reason)) continue;
        counts[entry.reason] = (counts[entry.reason] ?? 0) + 1;
      }
      state.skipped.value = counts;
      return;
    }
    case 'done':
      state.standing.value = 'done';
      return;
    case 'error':
      state.standing.value = { failed: isString(data.code) ? data.code : 'internal' };
      return;
    default:
      return;
  }
}

/**
 * A row from a `records` entry: its values as read, and an editable copy of the values proposed.
 */
function rowFrom(record: Record<string, unknown>): TransformRow | undefined {
  const { UUID, source, proposed, fallback } = record;
  if (!isString(UUID) || !isPlainObject(source) || !isPlainObject(proposed)) return undefined;
  const edits: Record<string, Ref<string>> = {};
  const read: Record<string, string | null> = {};
  for (const name of Object.keys(source)) {
    read[name] = isString(source[name]) ? source[name] : null;
    edits[name] = ref(isString(proposed[name]) ? proposed[name] : '');
  }
  return { id: UUID, UUID, source: read, edits, fallback: fallback === true };
}

/**
 * Whether the model changed any value of the row.
 */
function differs(row: TransformRow): boolean {
  return Object.keys(row.source).some(
    (name) => untracked(() => row.edits[name].value) !== (row.source[name] ?? ''),
  );
}

/**
 * Seeds the record's label from the values read at `locale`, when every label field is among them.
 */
function seedFrom(
  row: TransformRow,
  collection: DashboardCollection,
  locale: string | undefined,
): void {
  if (!collection.labelFields.every((name) => hasKey(row.source, name))) return;
  const label = joinLabel(row.source, collection);
  if (label !== '') seedLabel(collection.name, row.UUID, label, locale);
}

/**
 * The value a cell's text stands for: `null` for an emptied nullable field, the text otherwise.
 */
function valueOf(collection: DashboardCollection | null, name: string, text: string): unknown {
  if (text !== '') return text;
  const nullable = collection?.fields.find((field) => field.name === name)?.nullable === true;
  return nullable ? null : text;
}

/**
 * The model row: the picker over every model that may see values, and the button that reruns on it.
 */
function modelRow(
  state: TransformState,
  options: TransformTableOptions,
  collection: DashboardCollection | null,
  t: AITranslate,
): Child {
  const choices = (): { label: string; value: Primitive }[] =>
    (aiMeta()?.transformModels ?? []).map((name) => ({ label: name, value: name }));
  return h(
    'div',
    { class: 'o-transform-model' },
    h('span', null, () => t('ai.dashboard.model')),
    select(state.model, choices, { size: -1, disabled: () => choices().length === 0 }),
    button(() => t('ai.dashboard.transform.retry'), {
      variant: 'outline',
      size: -1,
      disabled: () => state.standing.value === 'streaming' || choices().length === 0,
      onClick: () => queue(state, options, undefined, collection),
    }),
  );
}

/**
 * The run's standing: its progress while it streams, or why it failed.
 */
function standingLine(state: TransformState, t: AITranslate): Child {
  const standing = state.standing.value;
  if (standing === 'streaming') {
    const done =
      state.rows.value.length + Object.values(state.skipped.value).reduce((a, b) => a + b, 0);
    return [spinner(), t('ai.dashboard.transform.progress', { done, total: state.reached.value })];
  }
  if (standing === 'done') return null;
  const reason = standing.failed;
  const text =
    reason === 'noModel' ? t('ai.dashboard.transform.noModel') : t(`ai.dashboard.reason.${reason}`);
  return alert(text, {
    variant: 'destructive',
    title: t('ai.dashboard.transform.failed'),
    size: -1,
  });
}

/**
 * The skipped records in words: the count, then each reason with its own.
 */
function skippedLine(skipped: Record<string, number>, t: AITranslate): string {
  const count = Object.values(skipped).reduce((a, b) => a + b, 0);
  const reasons = Object.entries(skipped)
    .map(([reason, n]) => t(`ai.dashboard.transform.reason.${reason}`, { count: n }))
    .join(', ');
  return t('ai.dashboard.transform.skipped', { count, reasons });
}

/**
 * The record cell: the record's label opening it, and a mark when the model changed nothing in it.
 */
function recordCell(
  row: TransformRow,
  collection: DashboardCollection | null,
  changed: (row: TransformRow) => Record<string, unknown>,
  t: AITranslate,
): Child {
  if (isNull(collection)) return dimMark('-');
  return h(
    'div',
    { class: 'o-transform-cell' },
    recordLink(collection, row.UUID, { newTab: true }),
    when(
      () => isEmpty(changed(row)),
      () => h('div', { class: 'ohne-muted' }, () => t('ai.dashboard.transform.unchanged')),
    ),
  );
}

/**
 * The reason a refused request answers: the code its body names for a `400`, else the one its status means.
 */
async function refusalOf(response: Response): Promise<string> {
  if (response.status === 400) {
    const body: unknown = await response.json().catch(() => undefined);
    const code = isPlainObject(body) && isPlainObject(body.data) ? body.data.code : undefined;
    if (code === 'blindModel') return code;
  }
  return REASONS[response.status] ?? 'internal';
}

/**
 * A value as the current cell shows it: text as is, an empty one as a dash.
 */
function formatValue(value: string | null): Child {
  return isNull(value) || value === '' ? dimMark('-') : value;
}

/**
 * The label of a field of `collection`, or the name itself when it has none.
 */
function fieldLabel(collection: DashboardCollection | null, name: string): string {
  return collection?.fields.find((field) => field.name === name)?.label ?? name;
}
