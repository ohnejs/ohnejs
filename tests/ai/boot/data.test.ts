import { deepStrictEqual, doesNotReject, ok, rejects } from 'node:assert';
import { describe, it } from 'node:test';

import type { Config } from '../../../src/ohne/layers/config.ts';

import '../../../src/ai/boot/data.ts';
import { isOhneError } from '../../../src/ohne/error/ohne-error.ts';
import { applyHook } from '../../../src/ohne/hooks/apply-hook.ts';
import { withAI } from '../_fixture.ts';

const ready = () => applyHook('server:ready', { host: '127.0.0.1', port: 0 });

/**
 * The title and body of the block the `server:ready` hook throws under `ai`.
 */
async function refusal(ai: Config['ai']): Promise<{ title?: string; body?: unknown }> {
  let thrown: unknown;
  await withAI(ai, () =>
    rejects(ready(), (error: unknown) => {
      thrown = error;
      return true;
    }),
  );
  ok(isOhneError(thrown), String(thrown));
  return { title: thrown.title, body: thrown.body };
}

describe('the server:ready check', () => {
  it('passes the defaults and registered, readable names', async () => {
    await doesNotReject(ready());
    await withAI(
      { data: { Items: ['name', 'tooltip', 'UUID'] }, autoAccept: { fields: { Items: true } } },
      () => doesNotReject(ready()),
    );
    await withAI({ deny: { collections: ['Users', 'Sessions', 'AITurns', 'Items'] } }, () =>
      doesNotReject(ready()),
    );
  });

  it('refuses a collection `ai.data` names that is not registered, with a hint', async () => {
    deepStrictEqual(await refusal({ data: { Item: true } }), {
      title: '`ai.data` names unknown collection `Item`',
      body: ['No collection `Item` is registered.', 'Did you mean `Items`?'],
    });
  });

  it('refuses a collection the deny list names that is not registered', async () => {
    const { title } = await refusal({ deny: { collections: ['Users', 'Invoices'] } });
    deepStrictEqual(title, '`ai.deny.collections` names unknown collection `Invoices`');
  });

  it('refuses a field the collection lacks, with a hint', async () => {
    deepStrictEqual(await refusal({ autoAccept: { fields: { Items: ['nmae'] } } }), {
      title: '`ai.autoAccept.fields` names unknown field `Items.nmae`',
      body: ['`Items` has no readable field `nmae`.', 'Did you mean `name`?'],
    });
  });

  it('refuses a field no read returns', async () => {
    const { title } = await refusal({ data: { Items: ['name', 'secret'] } });
    deepStrictEqual(title, '`ai.data` names unknown field `Items.secret`');
  });
});
