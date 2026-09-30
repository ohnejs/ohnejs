import { deepStrictEqual, doesNotReject, ok, rejects } from 'node:assert';
import { describe, it } from 'node:test';

import type { FieldLayout } from '../../../src/ohne/fields/layout.ts';
import type { Config } from '../../../src/ohne/layers/config.ts';

import '../../../src/ai/boot/users.ts';
import AIUsersCollection from '../../../src/ai/collections/Users.ts';
import { accountLayout } from '../../../src/base/auth/account-layout.ts';
import UsersCollection from '../../../src/base/collections/Users.ts';
import { useCollections } from '../../../src/ohne/collections/use-collections.ts';
import { isOhneError } from '../../../src/ohne/error/ohne-error.ts';
import { applyHook } from '../../../src/ohne/hooks/apply-hook.ts';
import { userWith, withAI } from '../_fixture.ts';

const ready = () => applyHook('server:ready', { host: '127.0.0.1', port: 0 });

const ON: Config['ai'] = {
  model: 'smart',
  models: { smart: { provider: 'anthropic', model: 'claude-test', key: false } },
  autoAccept: { max: 5, fields: { Items: ['name'] } },
};

/**
 * The account layout of a user holding `roles`, under `ai`.
 */
async function layoutFor(ai: Config['ai'], ...roles: string[]): Promise<FieldLayout> {
  let layout: FieldLayout = [];
  await withAI(ai, async () => {
    layout = await accountLayout(userWith(...roles));
  });
  return layout;
}

describe('the server:ready check of `Users`', () => {
  it('passes the `Users` the layer ships', async () => {
    await doesNotReject(ready());
  });

  it('refuses a `Users` without `autoAccept`, naming the definition to spread', async () => {
    useCollections().register('Users', { name: 'Users', collection: UsersCollection });
    try {
      let thrown: unknown;
      await rejects(ready(), (error: unknown) => {
        thrown = error;
        return true;
      });
      ok(isOhneError(thrown), String(thrown));
      deepStrictEqual(
        { title: thrown.title, body: thrown.body },
        {
          title: 'The assistant layer needs `autoAccept` on `Users`',
          body: [
            "Your `collections/Users.ts` replaces the layer's, and it declares no `autoAccept` field.",
            '',
            'Spread `aiUsersDefinition` from `ohnejs/ai` in place of `usersDefinition`.',
          ],
        },
      );
    } finally {
      useCollections().register('Users', { name: 'Users', collection: AIUsersCollection });
    }
  });
});

describe('the auth:account-layout hook', () => {
  it('adds the card before the password card for a holder of `ai.use`', async () => {
    const layout = await layoutFor(ON, 'editor');
    deepStrictEqual(layout.slice(-2), [{ card: ['autoAccept'] }, { card: ['password'] }]);
  });

  it('leaves it out without `ai.use`', async () => {
    const layout = await layoutFor(ON, 'reader');
    ok(!JSON.stringify(layout).includes('autoAccept'));
  });

  it('leaves it out while the app lets no write run without asking', async () => {
    for (const ai of [
      undefined,
      { ...ON, autoAccept: { max: 0, fields: { Items: true as const } } },
      { ...ON, autoAccept: { max: 5 } },
    ]) {
      ok(!JSON.stringify(await layoutFor(ai, 'editor')).includes('autoAccept'));
    }
  });
});
