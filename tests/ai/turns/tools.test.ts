import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { PROPOSAL_KEYS, TRANSFORM_KEYS } from '../../../src/ai/turns/proposals.ts';
import { TOOLS } from '../../../src/ai/turns/tools.ts';

interface Schema {
  properties: Record<string, Schema>;
  items: Schema;
}

describe('TOOLS', () => {
  it('offers the model exactly the keys a proposal may carry', () => {
    const [request] = TOOLS;
    const proposal = (request.input as unknown as Schema).properties.requests.items;
    deepStrictEqual(new Set(Object.keys(proposal.properties)), PROPOSAL_KEYS);
    deepStrictEqual(new Set(Object.keys(proposal.properties.transform.properties)), TRANSFORM_KEYS);
  });
});
