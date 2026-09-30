import { searchByKeywords } from 'ohnejs/utils';

/**
 * One row the assistant adds to the palette.
 * A structural subset of the palette's `PaletteRow`, so this module stays free of the dashboard.
 */
export interface AskRow {
  /**
   * The row label.
   */
  label: string;

  /**
   * The row icon.
   */
  icon: 'sparkles' | 'route' | 'history';

  /**
   * An instant the row shows at its end, in epoch milliseconds.
   */
  time?: number;

  /**
   * Runs when the row is picked.
   */
  onSelect: () => void;
}

/**
 * One titled run of the assistant's rows, in the shape of the palette's `PaletteRowGroup`.
 */
export interface AskRowGroup {
  /**
   * A key stable across renders: `ai:` plus what the group lists.
   */
  key: string;

  /**
   * The group heading; `''` for none.
   */
  label: string;

  /**
   * The rows, in order.
   */
  rows: AskRow[];
}

/**
 * A skill or a flow the palette starts on `/`.
 */
export interface Starter {
  /**
   * Whether it is a skill or a flow.
   */
  kind: 'skill' | 'flow';

  /**
   * Its name, typed after `/`.
   */
  name: string;

  /**
   * Its title, as the row reads.
   */
  title: string;
}

/**
 * What the assistant's rows read and do.
 */
export interface AskRowsOptions {
  /**
   * The palette query, trimmed.
   */
  query: string;

  /**
   * The skills the person may start.
   */
  skills: readonly { name: string; title: string }[];

  /**
   * The flows the person may start.
   */
  flows: readonly { name: string; title: string }[];

  /**
   * The person's latest chats, newest first.
   */
  recent: readonly { id: string; title: string; updatedAt: number }[];

  /**
   * Whether the current turn settled, so a question may start a new one.
   */
  settled: boolean;

  /**
   * Translates an `ai.dashboard.*` key.
   */
  t(key: string, params?: Record<string, string | number>): string;

  /**
   * Starts a turn for `input`, with the skill or the flow when one is given.
   */
  start(input: string, starter?: Starter): void;

  /**
   * Shows the turn view without starting a turn.
   */
  view(): void;

  /**
   * Shows the turn view on a new, empty conversation.
   */
  fresh(): void;

  /**
   * Reopens the chat `id` in the turn view.
   */
  resume(id: string): void;
}

const WHITESPACE = /\s+/;

/**
 * The rows the assistant adds to the palette.
 * A query without a leading `/` gets one row: "Ask: <query>", or "Assistant" on a blank query.
 * Picking it starts a turn with the query.
 * On a blank query it opens a new chat, and while a turn still runs it only shows the turn view.
 * Once the turn settled, it also lists the person's recent chats whose title matches, newest activity first.
 * Each shows when it was last active; picking one reopens it.
 * A query starting with `/` lists the skills and the flows matching the word after it, skills first.
 * Picking one starts a turn with that skill, or walks that flow.
 * The words after the name are the question; without any, the title stands in.
 */
export function askRows(options: AskRowsOptions): AskRowGroup[] {
  const { query, t } = options;
  if (!query.startsWith('/')) {
    const label =
      query === ''
        ? t('ai.dashboard.assistant')
        : t('ai.dashboard.ask', { query }).replaceAll('`', '');
    const onSelect = (): void => {
      if (!options.settled) options.view();
      else if (query === '') options.fresh();
      else options.start(query);
    };
    const ask: AskRowGroup = {
      key: 'ai:ask',
      label: '',
      rows: [{ label, icon: 'sparkles', onSelect }],
    };
    const matching = new Set(searchByKeywords(options.recent, query, 'title'));
    const recent = options.recent.filter((chat) => matching.has(chat));
    if (!options.settled || recent.length === 0) return [ask];
    const rows = recent.map(
      (chat): AskRow => ({
        label: chat.title,
        icon: 'history',
        time: chat.updatedAt,
        onSelect: () => options.resume(chat.id),
      }),
    );
    return [ask, { key: 'ai:recent', label: t('ai.dashboard.recentChats'), rows }];
  }
  const [name = '', ...rest] = query.slice(1).split(WHITESPACE);
  const words = rest.join(' ');
  const all: Starter[] = [
    ...options.skills.map(({ name, title }): Starter => ({ kind: 'skill', name, title })),
    ...options.flows.map(({ name, title }): Starter => ({ kind: 'flow', name, title })),
  ];
  const found = name === '' ? all : searchByKeywords(all, name, ['name', 'title']);
  const group = (kind: Starter['kind'], label: string): AskRowGroup[] => {
    const rows = found
      .filter((starter) => starter.kind === kind)
      .map(
        (starter): AskRow => ({
          label: starter.title,
          icon: starter.kind === 'flow' ? 'route' : 'sparkles',
          onSelect: () => options.start(words === '' ? starter.title : words, starter),
        }),
      );
    return rows.length === 0 ? [] : [{ key: `ai:${kind}`, label, rows }];
  };
  return [...group('skill', t('ai.dashboard.skills')), ...group('flow', t('ai.dashboard.flows'))];
}
