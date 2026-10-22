import { strictEqual } from 'node:assert';
import { afterEach, beforeEach, describe, it } from 'node:test';

import type { EffectScope } from '../../../src/utils/reactive/effect-scope.ts';

import { type FakeElement, FakeText, findElement, hasClass } from '../_fake-dom.ts';
import { requests, resetFetch, settle } from '../_fake-fetch.ts';

const { h } = await import('../../../src/dashboard/render/h.ts');
const { clearResourceCache } = await import('../../../src/dashboard/runtime/_resource-cache.ts');
const { useResource } = await import('../../../src/dashboard/runtime/resource.ts');
const { loaded } = await import('../../../src/dashboard/ui/loaded.ts');
const { flush } = await import('../../../src/utils/reactive/_scheduler.ts');
const { effectScope } = await import('../../../src/utils/reactive/effect-scope.ts');
const { ref } = await import('../../../src/utils/reactive/ref.ts');

let scope: EffectScope;

const mount = (build: () => ReturnType<typeof loaded>): FakeElement => {
  scope = effectScope();
  return scope.run(() => h('div', null, build())) as unknown as FakeElement;
};

const text = (root: FakeElement): string => {
  flush();
  return root.textContent;
};

beforeEach(() => {
  resetFetch();
  clearResourceCache();
});

afterEach(() => scope.dispose());

describe('loaded', () => {
  it('holds a skeleton, then renders once with a live getter', () => {
    const raids = ref<string[] | undefined>(undefined);
    let builds = 0;
    const root = mount(() =>
      loaded(
        () => raids.value,
        (list) => {
          builds += 1;
          return h('p', null, () => list().join(', '));
        },
      ),
    );
    flush();
    strictEqual(
      findElement(root, (element) => hasClass(element, 'ohne-skeleton')) !== undefined,
      true,
    );
    raids.value = ['Molten Core'];
    strictEqual(text(root), 'Molten Core');
    raids.value = ['Molten Core', 'Onyxia'];
    strictEqual(text(root), 'Molten Core, Onyxia');
    strictEqual(builds, 1);
  });

  it('shows the empty state for an empty array or a custom check', () => {
    const root = mount(() =>
      loaded(
        () => [],
        () => 'never',
        { emptyText: 'No raids this week' },
      ),
    );
    strictEqual(text(root), 'No raids this week');
    scope.dispose();
    const custom = mount(() =>
      loaded(
        () => ({ total: 0 }),
        () => 'never',
        { empty: (value) => value.total === 0, emptyText: 'Nobody online' },
      ),
    );
    strictEqual(text(custom), 'Nobody online');
  });

  it('shows an error with a retry, then an alert over old data', async () => {
    let root!: FakeElement;
    const raids = (() => {
      let resource!: ReturnType<typeof useResource<string[]>>;
      root = mount(() => {
        resource = useResource<string[]>('GET /raids');
        return loaded(resource, (list) => h('p', null, () => list().join(', ')));
      });
      return resource;
    })();
    requests[0].answer(500, { statusCode: 500, message: 'The portal collapsed' });
    await settle();
    strictEqual(text(root), 'The portal collapsedRetry');
    void raids.reload();
    requests[1].answer(200, ['Naxxramas']);
    await settle();
    strictEqual(text(root), 'Naxxramas');
    void raids.reload();
    requests[2].answer(500, { statusCode: 500, message: 'The portal collapsed' });
    await settle();
    strictEqual(text(root), 'The portal collapsedRetryNaxxramas');
  });

  it('shows the forbidden state for a 403', async () => {
    const root = mount(() => loaded(useResource('GET /vault'), () => 'never'));
    requests[0].answer(403, { statusCode: 403, message: 'Officers only' });
    await settle();
    strictEqual(text(root), 'You do not have access to this');
  });

  it('contains a throw inside render', () => {
    const original = console.error;
    console.error = () => {};
    try {
      const root = mount(() =>
        loaded(
          () => 1,
          () => {
            throw new Error('Deathwing');
          },
        ),
      );
      strictEqual(text(root), 'Failed to load');
    } finally {
      console.error = original;
    }
  });

  it('dims a stale value', async () => {
    const zone = ref('Durotar');
    const root = mount(() =>
      loaded(
        useResource<string[]>('GET /quests', { query: () => ({ zone: zone.value }) }),
        (list) => h('p', null, () => list().join(', ')),
      ),
    );
    requests[0].answer(200, ['Valley of Trials']);
    await settle();
    zone.value = 'Barrens';
    flush();
    const region = findElement(root, (element) => hasClass(element, 'ohne-loaded'));
    strictEqual(region?.getAttribute('class'), 'ohne-loaded ohne-loaded-stale');
  });

  it('boxes text, so a stale dim reaches it', () => {
    const zone = ref('Durotar');
    const root = mount(() =>
      loaded(
        () => zone.value,
        (value) => ['Zone ', () => value()],
      ),
    );
    flush();
    const content = findElement(root, (element) => hasClass(element, 'ohne-loaded-content'));
    const bare = () => content?.childNodes.filter((node) => node instanceof FakeText).length;
    strictEqual(bare(), 0);
    zone.value = 'Barrens';
    strictEqual(text(root), 'Zone Barrens');
    strictEqual(bare(), 0);
  });
});
