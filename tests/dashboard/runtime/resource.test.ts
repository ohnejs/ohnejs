import { deepStrictEqual, strictEqual } from 'node:assert';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import { startSession } from '../../../src/dashboard/runtime/_request.ts';
import { clearResourceCache } from '../../../src/dashboard/runtime/_resource-cache.ts';
import { markDataChanged } from '../../../src/dashboard/runtime/data-changes.ts';
import {
  type Resource,
  type ResourceOptions,
  resourceState,
  useResource,
} from '../../../src/dashboard/runtime/resource.ts';
import { login } from '../../../src/dashboard/runtime/session.ts';
import { requestDashboardLanguage } from '../../../src/dashboard/runtime/set-dashboard-language.ts';
import { effectScope, type EffectScope } from '../../../src/utils/reactive/effect-scope.ts';
import { ref } from '../../../src/utils/reactive/ref.ts';
import { requests, resetFetch, setVisibility, settle } from '../_fake-fetch.ts';

const scopes: EffectScope[] = [];

const read = <T>(route: string, options?: ResourceOptions): Resource<T> => {
  const scope = effectScope();
  scopes.push(scope);
  return scope.run(() => useResource<T>(route, options))!;
};

beforeEach(() => {
  resetFetch();
  clearResourceCache();
});

afterEach(() => {
  for (const scope of scopes.splice(0)) scope.dispose();
});

describe('useResource', () => {
  it('loads the filled route and turns ready', async () => {
    const guild = read<{ name: string }>('GET /guilds/[id]', {
      params: { id: 7 },
      query: { members: true },
    });
    strictEqual(guild.state(), 'loading');
    strictEqual(guild.busy(), true);
    strictEqual(requests[0].url, 'http://api/guilds/7?members=true');
    requests[0].answer(200, { name: 'Horde' });
    await settle();
    deepStrictEqual(guild(), { name: 'Horde' });
    strictEqual(guild.state(), 'ready');
    strictEqual(guild.busy(), false);
  });

  it('shares one request between readers of the same key', () => {
    read('GET /raids');
    read('GET /raids');
    strictEqual(requests.length, 1);
  });

  it('aborts a shared request only when its last reader leaves', () => {
    read('GET /raids');
    read('GET /raids');
    scopes[0].dispose();
    strictEqual(requests[0].aborted, false);
    scopes[1].dispose();
    strictEqual(requests[0].aborted, true);
  });

  it('starts a fresh request on reload instead of joining the one in flight', async () => {
    const raids = read<string[]>('GET /raids');
    const reloaded = raids.reload();
    strictEqual(requests.length, 2);
    requests[1].answer(200, ['Molten Core']);
    await reloaded;
    deepStrictEqual(raids(), ['Molten Core']);
  });

  it('keeps a newer answer when an older shared request settles late', async () => {
    const first = read<string[]>('GET /raids');
    const second = read<string[]>('GET /raids');
    const reloaded = first.reload();
    requests[1].answer(200, ['Naxxramas']);
    await reloaded;
    requests[0].answer(200, ['Onyxia']);
    await settle();
    deepStrictEqual(second(), ['Naxxramas']);
    deepStrictEqual(read<string[]>('GET /raids')(), ['Naxxramas']);
  });

  it('drops the answer of a superseded key', async () => {
    const zone = ref('Durotar');
    read('GET /quests', { query: { zone: 'Durotar' } });
    const quests = read<string[]>('GET /quests', { query: () => ({ zone: zone.value }) });
    zone.value = 'Barrens';
    requests[1].answer(200, ['Wailing Caverns']);
    await settle();
    requests[0].answer(200, ['Valley of Trials']);
    await settle();
    deepStrictEqual(quests(), ['Wailing Caverns']);
  });

  it('shows another query of the same read as stale until its answer lands', async () => {
    const zone = ref('Durotar');
    const quests = read<string[]>('GET /quests', { query: () => ({ zone: zone.value }) });
    requests[0].answer(200, ['Valley of Trials']);
    await settle();
    zone.value = 'Barrens';
    deepStrictEqual(quests(), ['Valley of Trials']);
    strictEqual(quests.stale(), true);
    strictEqual(quests.busy(), true);
    requests[1].answer(200, ['Wailing Caverns']);
    await settle();
    deepStrictEqual(quests(), ['Wailing Caverns']);
    strictEqual(quests.stale(), false);
  });

  it("keeps its own value as the stand-in over another reader's answer", async () => {
    const zone = ref('Durotar');
    const quests = read<string[]>('GET /quests', { query: () => ({ zone: zone.value }) });
    requests[0].answer(200, ['Valley of Trials']);
    await settle();
    read('GET /quests', { query: { zone: 'Mulgore' } });
    requests[1].answer(200, ['Red Cloud Mesa']);
    await settle();
    zone.value = 'Barrens';
    deepStrictEqual(quests(), ['Valley of Trials']);
  });

  it('drops a stale value when the new query fails', async () => {
    const zone = ref('Durotar');
    const quests = read<string[]>('GET /quests', { query: () => ({ zone: zone.value }) });
    requests[0].answer(200, ['Valley of Trials']);
    await settle();
    zone.value = 'Barrens';
    requests[1].answer(500, { statusCode: 500, message: 'The Barrens burned' });
    await settle();
    strictEqual(quests(), undefined);
    strictEqual(quests.state(), 'error');
  });

  it('shows a cached answer for the same key at once and revalidates quietly', async () => {
    read<string[]>('GET /raids');
    requests[0].answer(200, ['Onyxia']);
    await settle();
    const again = read<string[]>('GET /raids');
    deepStrictEqual(again(), ['Onyxia']);
    strictEqual(again.stale(), false);
    strictEqual(again.busy(), false);
    strictEqual(requests.length, 2);
  });

  it('caches a reload under the language it was sent in', async () => {
    const labels = read<string>('GET /labels');
    requests[0].answer(200, 'Guild');
    await settle();
    requestDashboardLanguage('de');
    try {
      const reloaded = labels.reload();
      requests[1].answer(200, 'Gilde');
      await reloaded;
    } finally {
      requestDashboardLanguage('en');
    }
    strictEqual(read<string>('GET /labels')(), 'Guild');
  });

  it('reads a 403 as forbidden and keeps the value through other failures', async () => {
    const raids = read<string[]>('GET /raids');
    requests[0].answer(200, ['Onyxia']);
    await settle();
    void raids.reload();
    requests[1].answer(500, { statusCode: 500, message: 'The portal collapsed' });
    await settle();
    strictEqual(raids.state(), 'error');
    strictEqual(raids.error()?.message, 'The portal collapsed');
    deepStrictEqual(raids(), ['Onyxia']);
    void raids.reload();
    requests[2].answer(403, { statusCode: 403, message: 'Officers only' });
    await settle();
    strictEqual(raids.state(), 'forbidden');
  });

  it('reads a network failure as status 0', async () => {
    const raids = read('GET /raids');
    requests[0].fail();
    await settle();
    strictEqual(raids.error()?.status, 0);
  });

  it('forgets cached answers when a session starts', async () => {
    read('GET /me');
    requests[0].answer(200, { name: 'Thrall' });
    await settle();
    startSession();
    strictEqual(read('GET /me')(), undefined);
  });

  it('loads again once the user signs in again in place', async () => {
    const me = read<{ name: string }>('GET /me');
    requests[0].answer(401, { statusCode: 401, message: 'Expired' });
    await settle();
    const signedIn = login('a@b.c', 'secret');
    requests[1].answer(200, {
      UUID: 'u',
      email: 'a@b.c',
      roles: [],
      dashboardLanguage: null,
      contentLanguage: null,
      timezone: null,
      dateFormat: 'YYYY-MM-DD',
      timeFormat: 'HH:mm',
      smartClipboard: false,
    });
    await signedIn;
    await settle();
    strictEqual(requests[2].url, 'http://api/me');
    requests[2].answer(200, { name: 'Thrall' });
    await settle();
    deepStrictEqual(me(), { name: 'Thrall' });
    strictEqual(me.state(), 'ready');
  });

  it('refetches quietly once the data changed', async () => {
    const raids = read<string[]>('GET /raids');
    requests[0].answer(200, ['Molten Core']);
    await settle();
    markDataChanged();
    strictEqual(requests[1].url, 'http://api/raids');
    strictEqual(raids.busy(), false);
    requests[1].answer(200, ['Naxxramas']);
    await settle();
    deepStrictEqual(raids(), ['Naxxramas']);
  });

  it('leaves a paused read paused once the data changed', () => {
    read('GET /heroes/[id]', { params: () => undefined });
    markDataChanged();
    strictEqual(requests.length, 0);
  });

  it('waits while a getter answers undefined', async () => {
    const id = ref<string | undefined>(undefined);
    const hero = read('GET /heroes/[id]', {
      params: () => (id.value ? { id: id.value } : undefined),
    });
    strictEqual(requests.length, 0);
    await hero.reload();
    strictEqual(requests.length, 0);
    id.value = 'jaina';
    strictEqual(requests[0].url, 'http://api/heroes/jaina');
  });

  it('polls only while the tab is visible and catches up on return', async () => {
    mock.timers.enable({ apis: ['setInterval'] });
    try {
      read('GET /auctions', { poll: 1000 });
      requests[0].answer(200, []);
      await settle();
      mock.timers.tick(1000);
      strictEqual(requests.length, 2);
      requests[1].answer(200, []);
      await settle();
      setVisibility('hidden');
      mock.timers.tick(1000);
      strictEqual(requests.length, 2);
      setVisibility('visible');
      strictEqual(requests.length, 3);
    } finally {
      mock.timers.reset();
    }
  });

  it('keeps busy off during poll ticks', async () => {
    mock.timers.enable({ apis: ['setInterval'] });
    try {
      const auctions = read('GET /auctions', { poll: 1000 });
      requests[0].answer(200, []);
      await settle();
      mock.timers.tick(1000);
      strictEqual(auctions.busy(), false);
    } finally {
      mock.timers.reset();
    }
  });

  it('picks a slice that shares the parent state', async () => {
    const guild = read<{ members: number }>('GET /guild');
    const members = guild.pick((value) => value.members);
    strictEqual(members(), undefined);
    requests[0].answer(200, { members: 40 });
    await settle();
    strictEqual(members(), 40);
    strictEqual(members.state(), 'ready');
    strictEqual(resourceState(members), 'ready');
  });

  it('answers no state for a plain getter', () => {
    strictEqual(
      resourceState(() => 1),
      undefined,
    );
  });
});
