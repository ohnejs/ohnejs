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
    deepStrictEqual(keywordsCondition(['ada', 'love'], ['first', 'last']), {
      and: [
        { or: [{ first: { contains: 'ada' } }, { last: { contains: 'ada' } }] },
        { or: [{ first: { contains: 'love' } }, { last: { contains: 'love' } }] },
      ],
    });
  });

  it('holds when every keyword appears in some field', () => {
    const ada = { first: 'Ada', last: 'Lovelace' };
    strictEqual(matches(['ada', 'love'], ['first', 'last'], ada), true);
    strictEqual(matches(['ada', 'turing'], ['first', 'last'], ada), false);
  });

  it('holds for every record without keywords and for none without fields', () => {
    strictEqual(matches([], ['first'], { first: 'Ada' }), true);
    strictEqual(matches(['ada'], [], { first: 'Ada' }), false);
  });
});
