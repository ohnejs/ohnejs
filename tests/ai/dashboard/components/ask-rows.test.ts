import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { askRows, type Starter } from '../../../../src/ai/dashboard/components/ask-rows.ts';
import { formatMessageAST, parseMessage } from '../../../../src/utils/index.ts';

const catalog = JSON.parse(
  readFileSync(new URL('../../../../src/ai/messages/ai/en.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;

/**
 * Formats one `ai.*` key from the English catalog, as the dashboard would.
 */
function t(key: string, params?: Record<string, string | number>): string {
  const template = key
    .split('.')
    .slice(1)
    .reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], catalog);
  return formatMessageAST(parseMessage(template as string), params, 'en');
}

const SKILLS = [
  { name: 'translate-items', title: 'Translate items' },
  { name: 'tidy', title: 'Tidy the roster' },
];

const FLOWS = [{ name: 'raid-officer', title: 'Raid officer' }];

const RECENT = [
  { id: 'chat-2', title: 'Rename the guild', updatedAt: 1_700_000_200_000 },
  { id: 'chat-1', title: 'Who is level 60?', updatedAt: 1_700_000_100_000 },
];

/**
 * The rows for `query`, and what picking one asked for.
 */
function rowsOf(query: string, settled = true, recent = RECENT) {
  const started: { input: string; starter?: Starter }[] = [];
  const resumed: string[] = [];
  let viewed = 0;
  let fresh = 0;
  const groups = askRows({
    query,
    skills: SKILLS,
    flows: FLOWS,
    recent,
    settled,
    t,
    start: (input, starter) => void started.push({ input, starter }),
    view: () => void viewed++,
    fresh: () => void fresh++,
    resume: (id) => void resumed.push(id),
  });
  const rows = groups.map((group) => ({
    key: group.key,
    label: group.label,
    rows: group.rows.map((row) => row.label),
  }));
  return { groups, rows, started, resumed, viewed: () => viewed, fresh: () => fresh };
}

describe('askRows', () => {
  it('offers the assistant on a blank query, which opens a new chat', () => {
    const { rows, groups, started, viewed, fresh } = rowsOf('', true, []);
    deepStrictEqual(rows, [{ key: 'ai:ask', label: '', rows: ['Assistant'] }]);
    groups[0].rows[0].onSelect();
    deepStrictEqual(started, []);
    deepStrictEqual([fresh(), viewed()], [1, 0]);
  });

  it('lists the recent chats under a blank, settled query, and reopens the one picked', () => {
    const { rows, groups, resumed } = rowsOf('');
    deepStrictEqual(rows, [
      { key: 'ai:ask', label: '', rows: ['Assistant'] },
      { key: 'ai:recent', label: 'Recent chats', rows: ['Rename the guild', 'Who is level 60?'] },
    ]);
    strictEqual(groups[1].rows[0].icon, 'history');
    strictEqual(groups[1].rows[0].time, 1_700_000_200_000);
    groups[1].rows[1].onSelect();
    deepStrictEqual(resumed, ['chat-1']);
  });

  it('lists the recent chats whose title matches a typed query', () => {
    deepStrictEqual(rowsOf('level').rows, [
      { key: 'ai:ask', label: '', rows: ['Ask: level'] },
      { key: 'ai:recent', label: 'Recent chats', rows: ['Who is level 60?'] },
    ]);
  });

  it('keeps the recent chats newest first when a query matches several', () => {
    deepStrictEqual(rowsOf('e').rows[1]?.rows, ['Rename the guild', 'Who is level 60?']);
    deepStrictEqual(rowsOf('l').rows[1]?.rows, ['Rename the guild', 'Who is level 60?']);
  });

  it('lists no recent chats when none matches, for a slash, or while a turn runs', () => {
    for (const { rows } of [rowsOf('paladin'), rowsOf('/'), rowsOf('', false)]) {
      ok(rows.every((group) => group.key !== 'ai:recent'));
    }
  });

  it('asks the typed question, stripping the highlight from its label', () => {
    const { rows, groups, started } = rowsOf('who is level 60', true, []);
    deepStrictEqual(rows, [{ key: 'ai:ask', label: '', rows: ['Ask: who is level 60'] }]);
    groups[0].rows[0].onSelect();
    deepStrictEqual(started, [{ input: 'who is level 60', starter: undefined }]);
  });

  it('only shows the turn view while a turn still runs', () => {
    const { groups, started, viewed } = rowsOf('and the rest?', false);
    groups[0].rows[0].onSelect();
    deepStrictEqual(started, []);
    strictEqual(viewed(), 1);
  });

  it('lists every skill and flow on a bare slash, skills first', () => {
    deepStrictEqual(rowsOf('/').rows, [
      { key: 'ai:skill', label: 'Skills', rows: ['Translate items', 'Tidy the roster'] },
      { key: 'ai:flow', label: 'Flows', rows: ['Raid officer'] },
    ]);
  });

  it('narrows to the starters matching the word after the slash, by name or title', () => {
    deepStrictEqual(rowsOf('/raid').rows, [
      { key: 'ai:flow', label: 'Flows', rows: ['Raid officer'] },
    ]);
    deepStrictEqual(rowsOf('/nothing').rows, []);
  });

  it('starts the starter with the words after its name, or with its title', () => {
    const typed = rowsOf('/translate-items into German');
    typed.groups[0].rows[0].onSelect();
    deepStrictEqual(typed.started, [
      {
        input: 'into German',
        starter: { kind: 'skill', name: 'translate-items', title: 'Translate items' },
      },
    ]);
    const bare = rowsOf('/raid');
    bare.groups[0].rows[0].onSelect();
    deepStrictEqual(bare.started, [
      {
        input: 'Raid officer',
        starter: { kind: 'flow', name: 'raid-officer', title: 'Raid officer' },
      },
    ]);
  });
});
