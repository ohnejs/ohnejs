import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { evaluateCondition } from '../../../src/utils/condition/evaluate-condition.ts';
import { keywordsCondition } from '../../../src/utils/condition/keywords-condition.ts';
import { parseCondition } from '../../../src/utils/condition/parse-condition.ts';

function matches(keywords: string[], fields: string[], record: Record<string, unknown>): boolean {
  const parsed = parseCondition(keywordsCondition(keywords, fields));
  ok(parsed.ok);
  return evaluateCondition(parsed.node, ([first]) => record[first]);
}

describe('keywordsCondition', () => {
  it('ors each keyword over the fields and ands the keywords', () => {
    deepStrictEqual(keywordsCondition(['anduin', 'wry'], ['first', 'last']), {
      and: [
        { or: [{ first: { contains: 'anduin' } }, { last: { contains: 'anduin' } }] },
        { or: [{ first: { contains: 'wry' } }, { last: { contains: 'wry' } }] },
      ],
    });
  });

  it('holds when every keyword appears in some field', () => {
    const anduin = { first: 'Anduin', last: 'Wrynn' };
    strictEqual(matches(['anduin', 'wry'], ['first', 'last'], anduin), true);
    strictEqual(matches(['anduin', 'arthas'], ['first', 'last'], anduin), false);
  });

  it('holds for every record without keywords and for none without fields', () => {
    strictEqual(matches([], ['first'], { first: 'Anduin' }), true);
    strictEqual(matches(['anduin'], [], { first: 'Anduin' }), false);
  });
});
