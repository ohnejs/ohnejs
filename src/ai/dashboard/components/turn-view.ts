import { serializeTableState } from 'app/components/collection-table-state.ts';
import {
  closePalette,
  isPaletteCommand,
  paletteQuery,
  paletteView,
} from 'app/components/palette-state.ts';
import {
  attachTooltip,
  type Child,
  css,
  type DashboardCollection,
  dashboardMeta,
  dimMark,
  each,
  fallbackLabel,
  formatDateTime,
  formatRelative,
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
  intersperse,
  isArray,
  isComposing,
  isEmpty,
  isNull,
  isNumber,
  isPlainObject,
  isString,
  isUndefined,
  isUUID,
  nextTick,
  onCleanup,
  parseRouteID,
  recordHref,
  ref,
  untracked,
  uuidv7Time,
} from 'ohnejs/utils';

import type { AITranslate } from './_ai-messages.ts';
import type { Proposal, ReadOutcome, Turn, TurnBatch, TurnStep, WriteTally } from './turn-store.ts';

import { useAIT } from './_ai-messages.ts';
import { aiMeta, collectionOfRoute } from './_ai-meta.ts';
import { spinner } from './_ai-spinner.ts';
import { recordLink } from './_record-link.ts';
import { approvalTable, proposedChanges } from './approval-table.ts';
import { answer, ask, decline } from './assistant.ts';
import { searchGroups } from './search-groups.ts';
import { batchOutcome, runsUnasked, sending, turns, turnSettled } from './turn-store.ts';

/**
 * How many records a read line names before it counts the rest.
 */
const REF_LIMIT = 5;

/**
 * How near its end, in pixels, the palette's scroll pane counts as at the end, so it follows new text.
 */
const END_SLACK = 8;

/**
 * What the turn shows under its steps, one case per look.
 */
type Standing = 'waiting' | 'thinking' | 'live' | 'error' | 'closed' | 'empty' | null;

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
  'left',
  'idle',
  'lost',
  'running',
]);

css`
  .o-turn-view {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    padding: 0.25rem 0;
  }

  .o-turn {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .o-turn-ask {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
    padding: 0.5rem 0.75rem;
    background-color: hsl(var(--ohne-muted));
    border-radius: calc(var(--ohne-radius) - 0.125rem);
  }

  .o-turn-prompt {
    flex: 1;
    min-width: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .o-turn-starter {
    font-weight: 500;
  }

  .o-turn-starter > svg {
    display: inline-block;
    margin-inline-end: 0.375em;
    vertical-align: -0.125em;
    color: hsl(var(--ohne-muted-foreground));
  }

  .o-turn-time {
    flex-shrink: 0;
    white-space: nowrap;
    color: hsl(var(--ohne-muted-foreground));
    font-size: calc(1em - 0.125rem);
  }

  .ohne-prose.o-turn-text {
    --ohne-spacing: -2;
    --ohne-line-height: 0;
  }

  .ohne-prose.o-turn-text > :where(h1, h2, h3, h4, h5, h6) {
    font-size: 1em;
  }

  .ohne-prose.o-turn-text > :where(h1, h2) {
    font-size: calc(1em + 0.125rem);
  }

  .o-turn .ohne-prose.o-turn-text :where(ul, ol) {
    padding-inline-start: 1.5em;
  }

  .o-turn .ohne-prose.o-turn-text :where(li)::marker,
  .o-turn .ohne-prose.o-turn-text :where(.ohne-prose-task) > svg,
  .o-turn .ohne-prose.o-turn-text :where(del) {
    color: hsl(var(--ohne-muted-foreground));
  }

  .o-turn .ohne-prose.o-turn-text :where(.ohne-prose-task) > svg {
    margin-inline-start: -1.375em;
  }

  .o-turn .ohne-prose.o-turn-text :where(:not(pre)) :where(code) {
    padding: 0.125em 0.375em;
    background-color: hsl(var(--ohne-muted));
    border-radius: calc(var(--ohne-radius) - 0.25rem);
    color: inherit;
    font-weight: 400;
  }

  .o-turn .ohne-prose.o-turn-text :where(pre) {
    padding: 0.75em 1em;
    background-color: hsl(var(--ohne-muted));
    border-radius: calc(var(--ohne-radius) - 0.125rem);
    color: hsl(var(--ohne-foreground));
  }

  .o-turn .ohne-prose.o-turn-text :where(blockquote) {
    border-left: 0.1875em solid hsl(var(--ohne-muted-foreground) / 0.4);
    color: hsl(var(--ohne-muted-foreground));
    font-weight: 400;
  }

  .o-turn .ohne-prose.o-turn-text :where(th, td):first-child {
    padding-inline-start: 0;
  }

  .o-turn .ohne-prose.o-turn-text :where(th, td):last-child {
    padding-inline-end: 0;
  }

  .o-turn-log {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .o-turn-log:empty {
    display: none;
  }

  .o-turn-log + .o-turn-log {
    margin-top: -0.5rem;
  }

  .o-turn-line {
    display: grid;
    grid-template-columns: 1rem minmax(0, 1fr);
    column-gap: 0.5rem;
    color: hsl(var(--ohne-muted-foreground));
    font-size: calc(1em - 0.0625rem);
    line-height: 1.25rem;
  }

  /* A line-tall box centres the glyph on the first text line. */
  .o-turn-line > svg {
    width: 1rem;
    height: 1.25rem;
  }

  .o-turn-line-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    column-gap: 0.75em;
  }

  .o-turn-error,
  .o-turn-failed {
    color: hsl(var(--ohne-destructive));
  }

  .o-turn-action {
    display: inline-flex;
    align-items: center;
    gap: 0.25em;
    color: hsl(var(--ohne-foreground));
    white-space: nowrap;
  }

  .o-turn-action:hover {
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }

  /* Restores the base focus ring, which ohne-raw opts out of. */
  .o-turn-action:focus-visible {
    box-shadow:
      0 0 0 0.125rem hsl(var(--ohne-background)),
      0 0 0 0.25rem hsl(var(--ohne-ring));
    outline: 0.125rem solid transparent;
    border-radius: 0.125rem;
  }

  .o-turn-action > svg {
    flex-shrink: 0;
  }

  .o-turn-auto {
    display: grid;
    grid-template-columns: fit-content(14em) minmax(0, 1fr);
    gap: 0.125rem 0.75em;
    padding-top: 0.125rem;
  }

  .o-turn-hint {
    color: hsl(var(--ohne-muted-foreground) / 0.72);
    font-size: calc(1em - 0.125rem);
  }

  .o-turn-hint:empty {
    display: none;
  }
`;

/**
 * The palette view of the conversation, shown while `paletteView` is `'turn'`.
 * Each turn shows the person's words, then every step: the model's text, its reads, and its writes.
 * Reads render as one line each, naming the records read; a write renders as an approval table.
 * The palette's input stays the way to ask: Enter on it follows up on the current turn once it settled.
 * The view follows new text while the person stays at its end; scrolling up holds it still.
 * Enter on a `/` command goes back to search instead, where skills and flows start.
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
    if (event.key !== 'Enter' || isComposing(event)) return;
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || isNull(target.closest('.o-palette-search')))
      return;
    event.preventDefault();
    event.stopPropagation();
    const input = untracked(() => paletteQuery.value.trim());
    if (isPaletteCommand(input)) {
      paletteView.value = 'search';
      return;
    }
    if (input === '' || !untracked(turnSettled)) return;
    paletteQuery.value = '';
    void ask(input, { after: untracked(followed) });
  };
  document.addEventListener('keydown', onKeydown, true);
  onCleanup(() => document.removeEventListener('keydown', onKeydown, true));

  const root = h(
    'div',
    { class: 'o-turn-view' },
    each(
      () => turns.value,
      (_, index) => index,
      (turn) => turnBlock(turn, t),
    ),
    h('div', { class: 'o-turn-hint' }, () =>
      turnSettled()
        ? t(turns.value.length === 0 ? 'ai.dashboard.start' : 'ai.dashboard.followUp')
        : '',
    ),
  );
  let pane: HTMLElement | null = null;
  let stuck = true;
  let last = 0;
  const onScroll = (): void => {
    if (isNull(pane)) return;
    if (pane.scrollTop + pane.clientHeight >= pane.scrollHeight - END_SLACK) stuck = true;
    // Only a move up lets go: content growing after our own scroll never lowers `scrollTop`.
    else if (pane.scrollTop < last) stuck = false;
    last = pane.scrollTop;
  };
  const attach = (): void => {
    const found = root.closest('.ohne-container');
    if (!isNull(pane) || !root.isConnected || !(found instanceof HTMLElement)) return;
    pane = found;
    observer.observe(pane);
    pane.addEventListener('scroll', onScroll, { passive: true });
  };
  // The pane is found and observed outside the callback, which would otherwise report a loop.
  const observer = new ResizeObserver(() => {
    if (isNull(pane)) void nextTick().then(attach);
    else if (stuck) pane.scrollTop = pane.scrollHeight;
  });
  observer.observe(root);
  onCleanup(() => {
    observer.disconnect();
    pane?.removeEventListener('scroll', onScroll);
  });
  let count = -1;
  effect(() => {
    const length = turns.value.length;
    if (length === count) return;
    count = length;
    stuck = true;
  });
  return root;
}

/**
 * The id a follow-up continues: the newest turn the server named.
 * A turn cut off before the server named it is skipped, so the chat still goes on.
 */
function followed(): string | undefined {
  return turns.value.findLast((turn) => !isNull(turn.id))?.id ?? undefined;
}

/**
 * One turn: the person's words, the steps, and the turn's standing.
 */
function turnBlock(turn: () => Turn, t: AITranslate): Child {
  const starter = (): boolean => !isNull(turn().skill) || !isNull(turn().flow);
  return h(
    'section',
    { class: 'o-turn' },
    h(
      'div',
      { class: 'o-turn-ask' },
      h(
        'p',
        { class: 'o-turn-prompt' },
        when(starter, () =>
          h(
            'span',
            { class: 'o-turn-starter' },
            () => icon(isNull(turn().flow) ? 'sparkles' : 'route'),
            () => starterTitle(turn()),
          ),
        ),
        when(
          () => starter() && words(turn()),
          () => dimMark(' · '),
        ),
        when(
          () => words(turn()),
          () => h('span', null, () => turn().input),
        ),
      ),
      when(
        () => !isNull(turn().id),
        () => askedAt(() => uuidv7Time(turn().id ?? '')),
      ),
    ),
    each(
      () => turn().steps,
      (_, index) => index,
      (step) => stepBlock(turn, step, t),
    ),
    standing(turn, t),
  );
}

/**
 * Whether the prompt shows the person's words: not when a skill or flow ran on its own title alone.
 */
function words(turn: Turn): boolean {
  const starter = !isNull(turn.skill) || !isNull(turn.flow);
  return !(starter && turn.input.trim() === starterTitle(turn));
}

/**
 * When the question was asked: relative, with the full date and time on hover.
 */
function askedAt(time: () => number): HTMLElement {
  const stamp = h('span', { class: 'o-turn-time' }, () => formatRelative(time()));
  onCleanup(attachTooltip(stamp, () => formatDateTime(time())));
  return stamp;
}

/**
 * One step: its text as prose, then its batch.
 * A local link in the text navigates in place, so it closes the palette on the way.
 */
function stepBlock(turn: () => Turn, step: () => TurnStep, t: AITranslate): Child {
  const text = h('div', {
    class: 'ohne-prose o-turn-text',
    onClick: (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest('a[href^="/"]')) closePalette();
    },
  });
  batchedEffect(() => renderProse(text, step().text, { links: 'local' }));
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
 * A step's batch: its log of what it did or is doing, then the approval table while it waits.
 * A batch its turn closed before answering logs nothing; the turn's reason says why.
 */
function batchBlock(turn: () => Turn, batch: () => TurnBatch, t: AITranslate): Child {
  const answering = (): boolean =>
    isNull(batch().results) && turn().status !== 'closed' && turn().status !== 'error';
  const asking = (): boolean => answering() && turn().status === 'waiting' && !runsUnasked(batch());
  return [
    h(
      'div',
      { class: 'o-turn-log' },
      when(
        () => !isNull(batch().results),
        () => outcomeLines(batch(), t),
        () =>
          when(
            () => answering() && !asking(),
            () => progressLine(batch, t),
          ),
      ),
      pageLine(turn, batch, t),
    ),
    when(asking, () =>
      approvalTable(batch, {
        onApprove: (approvals) => void answer(untracked(batch), approvals),
        onDecline: (note) => void decline(untracked(batch), note),
      }),
    ),
  ];
}

/**
 * The page the batch opens, a link to it: what became of it, or that it opens once the batch is done.
 * An open that a closed turn never answered shows nothing.
 */
function pageLine(turn: () => Turn, batch: () => TurnBatch, t: AITranslate): Child {
  return when(
    () =>
      !isUndefined(batch().open) &&
      (!isUndefined(batch().opened) || (turn().status !== 'closed' && turn().status !== 'error')),
    () => {
      const path = (): string => batch().open ?? '';
      const text = (): string =>
        t(`ai.dashboard.page.${batch().opened ?? 'pending'}`, { page: pageLabel(path(), t) });
      return line(icon('arrow-right'), action(text, { href: path, onClick: () => closePalette() }));
    },
  );
}

/**
 * How the person knows the page at `path`: its sidebar row, the record or collection it opens, else the path.
 * Reactive.
 */
function pageLabel(path: string, t: AITranslate): string {
  const meta = dashboardMeta();
  const row = meta?.menu.flatMap((group) => group.items).find((item) => item.to === path);
  if (!isUndefined(row)) return row.label;
  const uuid = path.split(/[/?&=#]/).find(isUUID);
  for (const collection of meta?.collections ?? []) {
    if (path === `/collections/${collection.segment}`) return collection.label;
    if (!isUndefined(uuid) && recordHref(collection, uuid) === path) {
      return labelOf(collection.name, uuid) ?? fallbackLabel(uuid);
    }
  }
  return path === '/account' ? t('dashboard.account.title') : path;
}

/**
 * The line of a batch that runs: reading, working toward its writes, or sending them.
 */
function progressLine(batch: () => TurnBatch, t: AITranslate): HTMLElement {
  return line(spinner(), () => {
    if (batch().kind === 'read') return t('ai.dashboard.reading');
    const progress = sending.value;
    return isNull(progress)
      ? t('ai.dashboard.progress.working')
      : t('ai.dashboard.progress.sending', { sent: progress.sent, total: progress.total });
  });
}

/**
 * What a settled batch did: one line per read that ran, then the writes' summary when it had any.
 */
function outcomeLines(batch: TurnBatch, t: AITranslate): Child {
  const { reads, writes } = batchOutcome(batch);
  const auto = batch.proposals.filter((proposal) => proposal.auto === true);
  return [
    reads.map(({ proposal, result }) =>
      parseRouteID(proposal.route).path === '/search' && result.status >= 200 && result.status < 300
        ? searchLines(proposal, result, t)
        : readLine(proposal, result, t),
    ),
    isNull(writes) ? null : writeLine(auto, writes, t),
  ];
}

/**
 * The writes' summary: sent, failed and unknown, or the decline.
 * Writes that ran without asking carry a marker, their changes folded away behind a toggle.
 */
function writeLine(auto: readonly Proposal[], writes: WriteTally, t: AITranslate): HTMLElement {
  const glyph = icon(
    writes.declined === writes.proposals
      ? 'x'
      : writes.failed + writes.unknown > 0
        ? 'alert-triangle'
        : 'check',
  );
  const summary = h('span', null, summaryParts(writes, t));
  if (auto.length === 0) return line(glyph, summary);
  const open = ref(false);
  return line(
    glyph,
    [
      summary,
      dimMark(t('ai.dashboard.batch.auto')),
      action(
        () => t(open.value ? 'ai.dashboard.batch.hideChanges' : 'ai.dashboard.batch.showChanges'),
        { onClick: () => void (open.value = !open.value) },
        () => icon(open.value ? 'chevron-up' : 'chevron-down'),
      ),
    ],
    when(
      () => open.value,
      () => h('div', { class: 'o-turn-auto' }, auto.map(autoWrite)),
    ),
  );
}

/**
 * One write that ran without asking, as two cells: the record it wrote, and the fields it set.
 */
function autoWrite(proposal: Proposal): Child {
  const collection = collectionOfRoute(proposal.route);
  const uuid = proposal.params?.uuid;
  return [
    isUndefined(collection) || isUndefined(uuid) ? dimMark('-') : recordLink(collection, uuid),
    h('div', null, proposedChanges(proposal)),
  ];
}

/**
 * What one read answered: how many records, which ones, and where to open them.
 */
function readLine(proposal: Proposal, result: ReadOutcome['result'], t: AITranslate): HTMLElement {
  const collection = collectionOfRoute(proposal.route);
  if (isUndefined(collection)) {
    return line(
      icon('eye'),
      t('ai.dashboard.read.app', { route: proposal.route }).replaceAll('`', ''),
    );
  }
  const name = collection.label;
  if (result.status < 200 || result.status >= 300) {
    const text =
      result.status === 0
        ? t('ai.dashboard.read.unknown', { collection: name })
        : t('ai.dashboard.read.failed', { collection: name, status: result.status });
    return line(icon('alert-triangle'), h('span', { class: 'o-turn-failed' }, text));
  }
  const { path } = parseRouteID(proposal.route);
  const body = result.body;
  const locale = [proposal.body?.locale, proposal.query?.locale].find(isString);
  if (path.endsWith('/query')) {
    const records = isPlainObject(body) && isArray(body.records) ? body.records : [];
    const count = isPlainObject(body) && isNumber(body.total) ? body.total : records.length;
    const where = proposal.body?.where;
    const filtered = isPlainObject(where) && !isEmpty(where);
    return line(
      icon('eye'),
      [
        h(
          'span',
          null,
          t(filtered ? 'ai.dashboard.read.listFiltered' : 'ai.dashboard.read.list', {
            count,
            collection: name,
          }),
        ),
        action(
          t('ai.dashboard.read.open', { collection: name }),
          { href: openHref(collection, proposal), onClick: () => closePalette() },
          icon('arrow-right'),
        ),
      ],
      refs(collection, records, count, locale),
    );
  }
  if (path.endsWith('/verdicts')) {
    return line(icon('eye'), t('ai.dashboard.read.verdicts', { collection: name }));
  }
  const uuid = proposal.params?.uuid;
  if (path.endsWith('/translations')) {
    return line(
      icon('eye'),
      t('ai.dashboard.read.translations', { collection: name }),
      isUndefined(uuid) ? null : refs(collection, [{ UUID: uuid }], 1, locale),
    );
  }
  return line(
    icon('eye'),
    t('ai.dashboard.read.record', { collection: name }),
    refs(collection, [body], 1, locale),
  );
}

/**
 * The words of a batch's writes, the failed and unknown parts in the error tone.
 */
function summaryParts(writes: WriteTally, t: AITranslate): Child[] {
  if (writes.declined === writes.proposals) return [t('ai.dashboard.batch.declined')];
  const parts: Child[] = [t('ai.dashboard.batch.sent', { count: writes.sent })];
  if (writes.failed > 0) {
    const text = t('ai.dashboard.batch.failed', { count: writes.failed });
    parts.push(h('span', { class: 'o-turn-failed' }, text));
  }
  if (writes.unknown > 0) {
    const text = t('ai.dashboard.batch.unknown', { count: writes.unknown });
    parts.push(h('span', { class: 'o-turn-failed' }, text));
  }
  return intersperse(parts, () => ', ');
}

/**
 * The turn's standing under its steps: a retry wait, the first token's wait, live text, a failure, or a cut.
 * A turn that closed without a word or a request says it found nothing to do.
 * The look rebuilds only when the case changes, so a spinner keeps turning while text streams.
 */
function standing(turn: () => Turn, t: AITranslate): Child {
  const current = ref<Standing>(null);
  effect(() => {
    current.value = standingOf(turn());
  });
  const log = (mark: Element, text: Child, tone?: 'error'): HTMLElement =>
    h('div', { class: 'o-turn-log' }, line(mark, text, null, tone));
  return () => {
    switch (current.value) {
      case 'waiting':
        return log(
          spinner(),
          retryIn(() => turn().wait ?? 0, t),
        );
      case 'thinking':
        return log(spinner(), t('ai.dashboard.thinking'));
      case 'live':
        return log(spinner(), null);
      case 'error':
        return log(icon('alert-triangle'), () => reasonText(turn().reason, t), 'error');
      case 'closed':
        return log(icon('info-circle'), () => reasonText(turn().reason, t));
      case 'empty':
        return log(icon('info-circle'), t('ai.dashboard.reason.empty'));
      default:
        return null;
    }
  };
}

/**
 * The words of a retry wait, counting down each second from when the wait arrived.
 */
function retryIn(wait: () => number, t: AITranslate): () => string {
  const left = ref(0);
  let timer: ReturnType<typeof setInterval> | undefined;
  effect(() => {
    const end = Date.now() + wait();
    const tick = (): void => {
      left.value = Math.max(0, Math.ceil((end - Date.now()) / 1000));
    };
    tick();
    clearInterval(timer);
    timer = setInterval(tick, 250);
  });
  onCleanup(() => clearInterval(timer));
  return () => t('ai.dashboard.waiting', { seconds: left.value });
}

/**
 * Which standing `turn` shows.
 */
function standingOf(turn: Turn): Standing {
  if (!isNull(turn.wait)) return 'waiting';
  const last = turn.steps.at(-1);
  if (turn.status === 'streaming') {
    if ((last?.text ?? '') === '') return 'thinking';
    return isNull(last?.batch ?? null) ? 'live' : null;
  }
  if (turn.status === 'error') return 'error';
  if (turn.status !== 'closed') return null;
  if (!isNull(turn.reason) && turn.reason !== 'end') return 'closed';
  return turn.steps.every((step) => step.text === '' && isNull(step.batch)) ? 'empty' : null;
}

/**
 * The sentence a reason code reads as; an unknown code reads as an internal failure.
 */
function reasonText(reason: string | null, t: AITranslate): string {
  const known = reason !== null && REASONS.has(reason) ? reason : 'internal';
  return t(`ai.dashboard.reason.${known}`);
}

/**
 * The title of the skill or flow the turn started with, or its name when the discovery read does not list it.
 */
function starterTitle({ skill, flow }: Turn): string {
  const meta = aiMeta();
  if (!isNull(skill)) return meta?.skills.find((entry) => entry.name === skill)?.title ?? skill;
  return meta?.flows.find((entry) => entry.name === flow)?.title ?? flow ?? '';
}

/**
 * One log line: a glyph in its own column, the head beside it, and a detail row under the head.
 * The glyph column gives wrapped text and the detail a hanging indent.
 */
function line(mark: Element, head: Child, detail: Child = null, tone?: 'error'): HTMLElement {
  return h(
    'div',
    { class: tone === 'error' ? 'o-turn-line o-turn-error' : 'o-turn-line' },
    mark,
    h('div', { class: 'o-turn-line-body' }, h('div', { class: 'o-turn-line-head' }, head), detail),
  );
}

/**
 * A quiet inline action: a link with `href`, else a button, its glyph trailing the label.
 */
function action(
  label: Child,
  attrs: { href?: string | (() => string); onClick: () => void },
  glyph: Child = null,
): HTMLElement {
  const content = [h('span', null, label), glyph];
  return isUndefined(attrs.href)
    ? h(
        'button',
        { class: 'ohne-raw o-turn-action', type: 'button', onClick: attrs.onClick },
        content,
      )
    : h(
        'a',
        { class: 'ohne-raw o-turn-action', href: attrs.href, onClick: attrs.onClick },
        content,
      );
}

/**
 * What a search found: one line per collection and per related group, naming the records as links.
 * A collection the discovery read does not list is left out; an empty answer says nothing was found.
 */
function searchLines(proposal: Proposal, result: ReadOutcome['result'], t: AITranslate): Child {
  const query = isString(proposal.body?.q) ? proposal.body.q : '';
  const groups = searchGroups(result.body);
  if (groups.length === 0) {
    return line(icon('search'), t('ai.dashboard.read.foundNone', { query }).replaceAll('`', ''));
  }
  const collections = dashboardMeta()?.collections ?? [];
  const find = (name: string) => collections.find((candidate) => candidate.name === name);
  return groups.flatMap(({ collection: name, via, hits, total }) => {
    const collection = find(name);
    if (isUndefined(collection)) return [];
    for (const { UUID, label } of hits) {
      if (isString(label) && label !== '') seedLabel(collection.name, UUID, label);
    }
    const params = { count: total, collection: collection.label, query };
    const text = isUndefined(via)
      ? t('ai.dashboard.read.found', params)
      : t('ai.dashboard.read.foundVia', { ...params, target: find(via)?.label ?? via });
    return [
      line(icon('search'), text.replaceAll('`', ''), refs(collection, hits, total, undefined)),
    ];
  });
}

/**
 * The first records of an answer as links, then how many more it holds.
 * A record carrying its label seeds the label cache at the `locale` it was read in.
 */
function refs(
  collection: DashboardCollection,
  records: readonly unknown[],
  total: number,
  locale: string | undefined,
): Child {
  const shown = records
    .slice(0, REF_LIMIT)
    .filter(isPlainObject)
    .filter((record) => isString(record.UUID));
  if (shown.length === 0) return null;
  const links = shown.map((record) => {
    const uuid = record.UUID as string;
    const label = joinLabel(record, collection);
    if (label !== '') seedLabel(collection.name, uuid, label, locale);
    return recordLink(collection, uuid);
  });
  return h(
    'div',
    { class: 'o-turn-refs' },
    intersperse(links, () => dimMark(', ')),
    total > shown.length ? dimMark(` +${total - shown.length}`) : null,
  );
}

/**
 * The address of the collection's table on the read's filter.
 */
function openHref(collection: DashboardCollection, proposal: Proposal): string {
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
  return `/collections/${collection.segment}${search === '' ? '' : `?${search}`}`;
}
