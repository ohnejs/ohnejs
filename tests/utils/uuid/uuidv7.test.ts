import { match, ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { sleep } from '../../../src/utils/index.ts';
import { uuidv7 } from '../../../src/utils/uuid/uuidv7.ts';

describe('uuidv7', () => {
  it('matches the canonical 8-4-4-4-12 shape', () => {
    match(uuidv7(), /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('sets the version nibble to 7', () => {
    strictEqual(uuidv7()[14], '7');
  });

  it('sets the variant bits to 10', () => {
    match(uuidv7()[19], /[89ab]/);
  });

  it('embeds the current timestamp in the first 48 bits', () => {
    const id = uuidv7();
    const ms = parseInt(id.slice(0, 8) + id.slice(9, 13), 16);
    ok(Math.abs(ms - Date.now()) < 1000);
  });

  it('sorts in generation order across milliseconds', async () => {
    const before = uuidv7();
    await sleep(5);
    ok(before < uuidv7());
  });

  it('yields unique ids within the same millisecond', () => {
    const ids = Array.from({ length: 1000 }, uuidv7);
    strictEqual(new Set(ids).size, ids.length);
  });
});
