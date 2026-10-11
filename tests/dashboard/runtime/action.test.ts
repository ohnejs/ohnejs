import { deepStrictEqual, strictEqual } from 'node:assert';
import { beforeEach, describe, it } from 'node:test';

import type { ActionForm } from '../../../src/dashboard/runtime/action.ts';

import { requests, resetFetch, settle } from '../_fake-fetch.ts';

const { useAction } = await import('../../../src/dashboard/runtime/action.ts');
const { useResource } = await import('../../../src/dashboard/runtime/resource.ts');
const { effectScope } = await import('../../../src/utils/reactive/effect-scope.ts');

const fakeForm = (reading: { value?: unknown; errors?: Record<string, string> }) => {
  const log: unknown[][] = [];
  const form: ActionForm = {
    read: () => (log.push(['read']), reading),
    readPatch: () => (log.push(['readPatch']), reading),
    setErrors: (errors) => (
      log.push(['setErrors', errors]),
      errors.title === undefined ? '' : 'left'
    ),
    rebase: (value) => void log.push(['rebase', value]),
    setBusy: (busy) => void log.push(['setBusy', busy]),
  };
  return { form, log };
};

beforeEach(resetFetch);

describe('useAction', () => {
  it('sends the body as JSON and hands the answer to onDone', async () => {
    let result: unknown;
    const save = useAction<{ id: number }>('POST /quests', { onDone: (value) => (result = value) });
    const done = save.run({ body: { name: 'The Den' } });
    strictEqual(requests[0].init.method, 'POST');
    strictEqual(requests[0].init.body, '{"name":"The Den"}');
    strictEqual(save.busy(), true);
    requests[0].answer(201, { id: 1 });
    strictEqual(await done, true);
    deepStrictEqual(result, { id: 1 });
    strictEqual(save.busy(), false);
  });

  it('sends a bare path as POST and fills params', async () => {
    const save = useAction('/guilds/[guild]/members', { params: { guild: 'horde' } });
    void save.run({ query: { role: 'officer' } });
    strictEqual(requests[0].init.method, 'POST');
    strictEqual(requests[0].url, 'http://api/guilds/horde/members?role=officer');
  });

  it('skips a run while the same request is in flight', async () => {
    const save = useAction('PATCH /heroes/[id]');
    const first = save.run({ params: { id: 'thrall' }, body: {} });
    strictEqual(await save.run({ params: { id: 'thrall' }, body: {} }), false);
    strictEqual(requests.length, 1);
    void save.run({ params: { id: 'jaina' }, body: {} });
    strictEqual(requests.length, 2);
    strictEqual(save.busy({ id: 'thrall' }), true);
    strictEqual(save.busy({ id: 'sylvanas' }), false);
    requests[0].answer(204);
    await first;
    strictEqual(save.busy({ id: 'thrall' }), false);
  });

  it('retries a busy 503 once', async () => {
    const save = useAction('POST /auctions');
    const done = save.run({ body: {} });
    requests[0].answer(503, { statusCode: 503, message: 'Busy' }, { 'retry-after': '0' });
    await settle();
    await settle();
    strictEqual(requests.length, 2);
    requests[1].answer(200, {});
    strictEqual(await done, true);
  });

  it('reads a PATCH from the form patch and rebases after a save', async () => {
    const { form, log } = fakeForm({ value: { motd: 'For the Horde' } });
    const save = useAction('PATCH /guild', { form });
    const done = save.run();
    requests[0].answer(200, {});
    await done;
    deepStrictEqual(log, [
      ['readPatch'],
      ['setBusy', true],
      ['setBusy', false],
      ['rebase', { motd: 'For the Horde' }],
    ]);
  });

  it('frees the form once its own call settles, while an unbound call is still in flight', async () => {
    const { form, log } = fakeForm({ value: { motd: 'Lok-tar' } });
    const save = useAction('POST /guild/[part]', { form });
    const bound = save.run({ params: { part: 'motd' } });
    const unbound = save.run({ params: { part: 'banner' }, body: {} });
    requests[0].answer(200, {});
    await bound;
    requests[1].answer(200, {});
    await unbound;
    deepStrictEqual(log.filter(([kind]) => kind === 'setBusy').at(-1), ['setBusy', false]);
  });

  it('sends nothing for an empty patch or local errors', async () => {
    const empty = fakeForm({ value: {} });
    strictEqual(await useAction('PATCH /guild', { form: empty.form }).run(), false);
    const invalid = fakeForm({ errors: { motd: 'Too long' } });
    strictEqual(await useAction('POST /guild', { form: invalid.form }).run(), false);
    deepStrictEqual(invalid.log.at(-1), ['setErrors', { motd: 'Too long' }]);
    strictEqual(requests.length, 0);
  });

  it('routes 422 errors onto the form', async () => {
    const { form, log } = fakeForm({ value: { motd: '' } });
    const done = useAction('POST /guild', { form }).run();
    requests[0].answer(422, {
      statusCode: 422,
      message: 'Invalid',
      data: { errors: { motd: 'Required' } },
    });
    strictEqual(await done, false);
    deepStrictEqual(log.at(-1), ['setErrors', { motd: 'Required' }]);
  });

  it('reloads resources after a success', async () => {
    const scope = effectScope();
    const guild = scope.run(() => useResource('GET /guild'))!;
    requests[0].answer(200, {});
    await settle();
    const done = useAction('PATCH /guild', { reload: [guild] }).run({ body: { motd: 'Lok-tar' } });
    requests[1].answer(200, {});
    await done;
    strictEqual(requests[2].url, 'http://api/guild');
    scope.dispose();
  });

  it('hands failures to onError instead of a toast, and keeps a 401 silent', async () => {
    const seen: number[] = [];
    const save = useAction('POST /raids', { onError: (error) => seen.push(error.status) });
    const refused = save.run({ body: {} });
    requests[0].answer(401);
    await refused;
    const broken = save.run({ body: {} });
    requests[1].answer(500, { statusCode: 500, message: 'The portal collapsed' });
    await broken;
    const offline = save.run({ body: {} });
    requests[2].fail();
    await offline;
    deepStrictEqual(seen, [500, 0]);
  });
});
