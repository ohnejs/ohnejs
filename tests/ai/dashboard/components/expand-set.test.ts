import { deepStrictEqual, strictEqual } from 'node:assert';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import type { Proposal } from '../../../../src/ai/dashboard/components/turn-store.ts';

import {
  describeWhere,
  expandSet,
  type SetIO,
} from '../../../../src/ai/dashboard/components/expand-set.ts';
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

const LABELS: Record<string, string> = { level: 'Level', rarity: 'Rarity', guild: 'Guild' };

const words = { field: (name: string) => LABELS[name] ?? name, t };

describe('describeWhere', () => {
  it('puts each comparison into words and joins siblings with and', () => {
    strictEqual(
      describeWhere({ level: { lessThan: 10 }, rarity: 'epic' }, words),
      'Level is less than `10` and Rarity is `epic`',
    );
  });

  it('joins or branches, lists, negations, has and isNull', () => {
    strictEqual(
      describeWhere(
        { or: [{ rarity: { in: ['epic', 'rare'] } }, { level: { atLeast: 60 } }] },
        words,
      ),
      'Rarity is one of `epic, rare` or Level is at least `60`',
    );
    strictEqual(describeWhere({ not: { rarity: 'epic' } }, words), 'Rarity is not `epic`');
    strictEqual(
      describeWhere({ guild: { has: { name: 'Onyx Vanguard' } } }, words),
      'Guild has one where name is `Onyx Vanguard`',
    );
    strictEqual(describeWhere({ tooltip: { isNull: true } }, words), 'tooltip is empty');
    strictEqual(describeWhere({ not: { tooltip: { isNull: true } } }, words), 'tooltip is set');
    strictEqual(describeWhere({ guild: { has: true } }, words), 'Guild is set');
  });

  it('answers nothing for a filter the grammar refuses', () => {
    strictEqual(describeWhere({ level: null }, words), '');
    strictEqual(describeWhere('wild', words), '');
  });
});

const RETIRE: Proposal = {
  route: 'PATCH /collections/characters/[uuid]',
  tier: 'write',
  where: { level: { lessThan: 10 } },
  query: { locale: 'de' },
  body: { status: 'retired' },
};

describe('expandSet', () => {
  it('reads every page at the locale, labels each row, and marks the rows the verdict admits', async () => {
    const bodies: Record<string, unknown>[] = [];
    const asked: string[][] = [];
    const io: SetIO = {
      page: (body) => {
        bodies.push(body);
        const page = body.page as number;
        return Promise.resolve({
          records:
            page === 1
              ? [
                  { UUID: 'c-1', name: 'Ash', class: 'Rogue' },
                  { UUID: 'c-2', name: '', class: '' },
                ]
              : [{ UUID: 'c-3', name: 'Bran', class: 'Mage' }],
          lastPage: 2,
        });
      },
      verdict: (UUIDs) => {
        asked.push([...UUIDs]);
        return Promise.resolve(new Set(['c-1', 'c-3']));
      },
    };
    const rows = await expandSet(RETIRE, { labelFields: ['name', 'class'] }, io);
    deepStrictEqual(rows, [
      { UUID: 'c-1', label: 'Ash Rogue', mine: true },
      { UUID: 'c-2', label: '', mine: false },
      { UUID: 'c-3', label: 'Bran Mage', mine: true },
    ]);
    deepStrictEqual(bodies, [
      {
        where: RETIRE.where,
        select: ['UUID', 'name', 'class'],
        locale: 'de',
        page: 1,
        perPage: 50,
      },
      {
        where: RETIRE.where,
        select: ['UUID', 'name', 'class'],
        locale: 'de',
        page: 2,
        perPage: 50,
      },
    ]);
    deepStrictEqual(asked, [['c-1', 'c-2'], ['c-3']]);
  });

  it('answers nothing when a page fails, never part of the set', async () => {
    let calls = 0;
    const io: SetIO = {
      page: (body) => {
        calls += 1;
        deepStrictEqual(body.select, ['UUID']);
        return Promise.resolve(
          calls === 1 ? { records: [{ UUID: 'c-1' }], lastPage: 3 } : undefined,
        );
      },
      verdict: (UUIDs) => Promise.resolve(new Set(UUIDs)),
    };
    strictEqual(
      await expandSet({ ...RETIRE, query: undefined }, { labelFields: [] }, io),
      undefined,
    );
    strictEqual(calls, 2);
  });
});
