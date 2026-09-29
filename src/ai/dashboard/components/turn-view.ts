import { serializeTableState } from 'app/components/collection-table-state.ts';
import { closePalette, paletteQuery, paletteView } from 'app/components/palette-state.ts';
import {
  alert,
  badge,
  button,
  type Child,
  css,
  type DashboardCollection,
  each,
  fallbackLabel,
  h,
  icon,
  joinLabel,
  labelOf,
  renderProse,
  seedLabel,
  when,
} from 'ohnejs/dashboard';
import {
  batchedEffect,
  type ConditionObject,
  effect,
  isArray,
  isNumber,
  isPlainObject,
  isString,
  isUndefined,
  nextTick,
  onCleanup,
  parseRouteID,
  untracked,
} from 'ohnejs/utils';

import type { AITranslate } from './_ai-messages.ts';
import type { BatchResult, Proposal, Turn, TurnBatch, TurnStep } from './turn-store.ts';

import { useAIT } from './_ai-messages.ts';
import { aiMeta, collectionOfRoute } from './_ai-meta.ts';
import { approvalTable } from './approval-table.ts';
import { answer, ask, decline } from './assistant.ts';
import { sending, turns, turnSettled } from './turn-store.ts';

/**
 * How many records a read line names before it stops.
 */
const CHIP_LIMIT = 12;

const REASONS = new Set([
  'timeout',
  'provider',
  'internal',
  'network',
  'steps',
  'length',
  'refusal',
  'turnGone',
  'limit',
  'unavailable',
  'forbidden',
  'off',
  'signedOut',
]);

css`
  .o-turn-view {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    padding: 0.25rem 0;
  }

  .o-turn {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .o-turn-ask {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    background-color: hsl(var(--ohne-muted));
    border-radius: calc(var(--ohne-radius) - 0.125rem);
    font-size: 0.875rem;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .o-turn-text {
    font-size: 0.875rem;
  }

  .o-turn-line,
  .o-turn-status {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.375rem;
    font-size: 0.8125rem;
    color: hsl(var(--ohne-muted-foreground));
  }

  .o-turn-line > svg,
  .o-turn-status > svg {
    flex-shrink: 0;
    font-size: 1rem;
  }

  .o-turn-status:empty {
    display: none;
  }

  .o-turn-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }

  .o-turn-spinner {
    animation: o-turn-spin 1s linear infinite;
  }

  @keyframes o-turn-spin {
    to {
      transform: rotate(360deg);
    }
  }
`;

/**
 * The palette view of the conversation, shown while `paletteView` is `'turn'`.
 * Each turn shows the person's words, then every step: the model's text, its reads, and its writes.
 * Reads render as one line each, naming the records read; a write renders as an approval table.
 * The palette's input stays the way to ask: Enter on it starts a new turn once the current one settled.
 */
export function turnView(): Child {
  return when(() => paletteView.value === 'turn', view);
}

/**
 * The view proper.
 */
function view(): Child {
  const t = useAIT();

  // Capture phase on the document: the palette's input handles Enter only under the search view.
  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter') return;
    if (!(event.target instanceof Element) || event.target.closest('.o-palette-search') === null) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const input = untracked(() => paletteQuery.value.trim());
    if (input === '' || !untracked(turnSettled)) return;
    paletteQuery.value = '';
    void ask(input);
  };
  document.addEventListener('keydown', onKeydown, true);
  onCleanup(() => document.removeEventListener('keydown', onKeydown, true));

  const end = h('div');
  effect(() => {
    void turns.value;
    void nextTick().then(() => end.scrollIntoView({ block: 'end' }));
  });

  return h(
    'div',
    { class: 'o-turn-view' },
    each(
      () => turns.value,
      (_, index) => index,
      (turn) => turnBlock(turn, t),
    ),
    h('div', { class: 'o-turn-status' }, () =>
      turnSettled()
        ? t(turns.value.length === 0 ? 'ai.dashboard.start' : 'ai.dashboard.followUp')
        : '',
    ),
    end,
  );
}

/**
 * One turn: the person's words, the steps, and the turn's standing.
 */
function turnBlock(turn: () => Turn, t: AITranslate): Child {
  return h(
    'section',
    { class: 'o-turn' },
    h(
      'div',
      { class: 'o-turn-ask' },
      when(
        () => turn().skill !== null,
        () => badge(() => skillTitle(turn().skill ?? ''), { color: 'secondary', size: -2 }),
      ),
      h('span', null, () => turn().input),
    ),
    each(
      () => turn().steps,
      (_, index) => index,
      (step) => stepBlock(turn, step, t),
    ),
    h('div', { class: 'o-turn-status' }, () => standing(turn(), t)),
  );
}

/**
 * One step: its text as prose, then its batch.
 */
function stepBlock(turn: () => Turn, step: () => TurnStep, t: AITranslate): Child {
  const text = h('div', { class: 'ohne-prose o-turn-text' });
  batchedEffect(() => renderProse(text, step().text, { links: false }));
  return [
    when(
      () => step().text !== '',
      () => text,
    ),
    when(
      () => step().batch !== null,
      () => batchBlock(turn, () => step().batch as TurnBatch, t),
    ),
  ];
}

/**
 * A step's batch: the approval table while it waits, the progress while it sends, the outcome once it did.
 */
function batchBlock(turn: () => Turn, batch: () => TurnBatch, t: AITranslate): Child {
  return when(
    () => batch().results !== null,
    () => (batch().kind === 'read' ? readLines(batch(), t) : summaryLine(batch(), t)),
    () =>
      when(
        () => turn().status === 'waiting' && batch().kind !== 'read',
        () =>
          approvalTable(batch, {
            onApprove: (approvals) => void answer(untracked(batch), approvals),
            onDecline: (note) => void decline(untracked(batch), note),
          }),
        () =>
          h('div', { class: 'o-turn-status' }, spinner(), () => {
            if (batch().kind === 'read') return t('ai.dashboard.reading');
            const progress = sending.value;
            return progress === null
              ? t('ai.dashboard.working')
              : t('ai.dashboard.sending', { sent: progress.sent, total: progress.total });
          }),
      ),
  );
}

/**
 * One line per read of a settled batch.
 */
function readLines(batch: TurnBatch, t: AITranslate): Child {
  const results = batch.results ?? [];
  return batch.proposals.map((proposal, index) => readLine(proposal, results[index], t));
}

/**
 * What one read answered: how many records, which ones, and where to open them.
 */
function readLine(proposal: Proposal, result: BatchResult | undefined, t: AITranslate): Child {
  if (isUndefined(result) || 'declined' in result) return null;
  const collection = collectionOfRoute(proposal.route);
  if (isUndefined(collection)) {
    return line(t('ai.dashboard.read.app', { route: proposal.route }).replaceAll('`', ''));
  }
  const name = collection.label;
  if (result.status < 200 || result.status >= 300) {
    return line(t('ai.dashboard.read.failed', { collection: name, status: result.status }));
  }
  const { path } = parseRouteID(proposal.route);
  const body = result.body;
  if (path.endsWith('/query')) {
    const records = isPlainObject(body) && isArray(body.records) ? body.records : [];
    const count = isPlainObject(body) && isNumber(body.total) ? body.total : records.length;
    return line(
      t('ai.dashboard.read.list', { count, collection: name }),
      chips(collection, records),
      openLink(collection, proposal, t),
    );
  }
  if (path.endsWith('/verdicts'))
    return line(t('ai.dashboard.read.verdicts', { collection: name }));
  const uuid = proposal.params?.uuid;
  if (path.endsWith('/translations')) {
    return line(
      t('ai.dashboard.read.translations', { collection: name }),
      isUndefined(uuid) ? null : chips(collection, [{ UUID: uuid }]),
    );
  }
  return line(t('ai.dashboard.read.record', { collection: name }), chips(collection, [body]));
}

/**
 * The outcome of a settled write batch: the changes sent and failed, or the decline.
 */
function summaryLine(batch: TurnBatch, t: AITranslate): Child {
  const results = batch.results ?? [];
  let sent = 0;
  let failed = 0;
  let declined = 0;
  let writes = 0;
  for (const [index, proposal] of batch.proposals.entries()) {
    const result = results[index];
    if (proposal.tier === 'read' || isUndefined(result)) continue;
    writes += 1;
    if ('declined' in result) {
      declined += 1;
      continue;
    }
    const body = isPlainObject(result.body) ? result.body : {};
    if (!isUndefined(proposal.where)) {
      sent += isNumber(body.total) ? body.total : 0;
      failed += isNumber(body.failed) ? body.failed : 0;
    } else if (result.status >= 200 && result.status < 300) {
      sent += 1;
    } else {
      failed += 1;
    }
  }
  if (declined === writes) return line(t('ai.dashboard.batch.declined'));
  const failures = failed === 0 ? '' : `, ${t('ai.dashboard.batch.failed', { count: failed })}`;
  return line(`${t('ai.dashboard.batch.sent', { count: sent })}${failures}`);
}

/**
 * The turn's standing under its steps: a retry wait, the first token's wait, a failure, or a cut.
 */
function standing(turn: Turn, t: AITranslate): Child {
  if (turn.wait !== null) {
    return [spinner(), t('ai.dashboard.waiting', { seconds: Math.ceil(turn.wait / 1000) })];
  }
  if (turn.status === 'streaming' && (turn.steps.at(-1)?.text ?? '') === '') {
    return [spinner(), t('ai.dashboard.thinking')];
  }
  if (turn.status === 'error') {
    return alert(reasonText(turn.reason, t), {
      variant: 'destructive',
      title: t('ai.dashboard.failed'),
      size: -1,
    });
  }
  if (turn.status === 'closed' && turn.reason !== null && turn.reason !== 'end') {
    return reasonText(turn.reason, t);
  }
  return null;
}

/**
 * The sentence a reason code reads as; an unknown code reads as an internal failure.
 */
function reasonText(reason: string | null, t: AITranslate): string {
  const known = reason !== null && REASONS.has(reason) ? reason : 'internal';
  return t(`ai.dashboard.reason.${known}`);
}

/**
 * The title of the skill `name`, or the name when the discovery read does not list it.
 */
function skillTitle(name: string): string {
  return aiMeta()?.skills.find((skill) => skill.name === name)?.title ?? name;
}

/**
 * One read line: an eye, the words, and what follows them.
 */
function line(text: string, ...rest: Child[]): HTMLElement {
  return h('div', { class: 'o-turn-line' }, icon('eye'), h('span', null, text), rest);
}

/**
 * The spinning loader of a line that waits.
 */
function spinner(): SVGSVGElement {
  const glyph = icon('loader-2');
  glyph.classList.add('o-turn-spinner');
  return glyph;
}

/**
 * Chips naming the first records of an answer, each opening its record.
 * A record carrying its label seeds the label cache, so the chip needs no read of its own.
 */
function chips(collection: DashboardCollection, records: readonly unknown[]): Child {
  const shown = records.slice(0, CHIP_LIMIT).filter(isPlainObject);
  return h(
    'span',
    { class: 'o-turn-chips' },
    shown.map((record) => {
      const uuid = record.UUID;
      if (!isString(uuid)) return null;
      const label = joinLabel(record, collection);
      if (label !== '') seedLabel(collection.name, uuid, label);
      return button(() => labelOf(collection.name, uuid) ?? fallbackLabel(uuid), {
        href: `/collections/${collection.segment}/${uuid}`,
        variant: 'outline',
        size: -2,
        onClick: () => closePalette(),
      });
    }),
  );
}

/**
 * The link opening the collection's table on the read's filter.
 */
function openLink(collection: DashboardCollection, proposal: Proposal, t: AITranslate): Child {
  const where = proposal.body?.where;
  const search = serializeTableState(
    {
      page: 1,
      order: [],
      where: isPlainObject(where) ? (where as ConditionObject) : undefined,
      columns: undefined,
    },
    [],
  );
  return button(() => t('ai.dashboard.read.open', { collection: collection.label }), {
    href: `/collections/${collection.segment}${search === '' ? '' : `?${search}`}`,
    variant: 'ghost',
    size: -2,
    onClick: () => closePalette(),
  });
}
