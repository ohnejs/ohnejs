import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { evaluateCondition } from '../../../src/utils/condition/evaluate-condition.ts';
import { parseCondition } from '../../../src/utils/condition/parse-condition.ts';
import { conditionResolver } from '../../../src/utils/condition/resolve-condition.ts';

function holds(condition: unknown, resolve: (path: readonly string[]) => unknown): boolean {
  const parsed = parseCondition(condition);
  if (!parsed.ok) throw new Error(`parse failed: ${JSON.stringify(parsed.error)}`);
  return evaluateCondition(parsed.node, resolve);
}

describe('conditionResolver', () => {
  const root = { kind: 'promo', address: { city: 'Sarajevo' } };
  const item = { title: 'Brew', details: { kilos: 600 } };
  const resolve = conditionResolver(item, [root]);

  it('reads a bare path from the scope', () => {
    strictEqual(resolve(['title']), 'Brew');
  });

  it('descends into a plain object', () => {
    strictEqual(resolve(['details', 'kilos']), 600);
  });

  it('climbs one scope per `..`', () => {
    strictEqual(resolve(['..', 'kind']), 'promo');
    strictEqual(resolve(['..', 'address', 'city']), 'Sarajevo');
  });

  it('reads the outermost scope through a leading `/`', () => {
    strictEqual(resolve(['/', 'kind']), 'promo');
    strictEqual(conditionResolver(root, [])(['/', 'kind']), 'promo');
  });

  it('resolves a climb past the root or a missing segment to `undefined`', () => {
    strictEqual(resolve(['..', '..', 'kind']), undefined);
    strictEqual(resolve(['title', 'length']), undefined);
    strictEqual(resolve(['missing']), undefined);
  });

  it('decides a gate the way the write pipeline does', () => {
    strictEqual(holds({ soldOut: true }, conditionResolver({ soldOut: false }, [])), false);
    strictEqual(holds({ soldOut: true }, conditionResolver({ soldOut: true }, [])), true);
    strictEqual(holds({ '../kind': 'promo' }, resolve), true);
    strictEqual(
      holds({ not: { page: { has: true } } }, conditionResolver({ page: null }, [])),
      true,
    );
  });
});
