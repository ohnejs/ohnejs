import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { DashboardMenuItem } from '../../../src/base/api/dashboard.get.ts';
import type { User } from '../../../src/base/auth/types.ts';
import type { DashboardCollection } from '../../../src/base/collections-api/describe.ts';

import { resolveDashboardMenu } from '../../../src/base/menu/resolve-menu.ts';
import { useCollections } from '../../../src/ohne/collections/use-collections.ts';
import { hook } from '../../../src/ohne/hooks/hook.ts';
import { useHooks } from '../../../src/ohne/hooks/use-hooks.ts';
import { type Config, DEFAULTS } from '../../../src/ohne/layers/config.ts';
import { useLayers } from '../../../src/ohne/layers/use-layers.ts';
import { useRoles } from '../../../src/ohne/roles/use-roles.ts';

declare module 'ohnejs' {
  interface KnownMessages {
    'menuTest.reports': { n: number };
    'menuTest.stats': { m: number };
  }
}

type Menu = NonNullable<NonNullable<Config['dashboard']>['menu']>;
type Outline = (string | { [id: string]: Outline })[];

useLayers().add({ path: '/menu-test', defaults: DEFAULTS });
useRoles().register('menu-editor', {
  name: 'menu-editor',
  role: { capabilities: ['reports.read'] },
});
useCollections().register('Secret', { name: 'Secret', collection: { fields: {} } });

const user = { roles: ['menu-editor'] } as unknown as User;
const posts = {
  name: 'Posts',
  segment: 'posts',
  label: 'Posts',
  icon: 'news',
} as DashboardCollection;
const tags = { name: 'Tags', segment: 'tags', label: 'Tags' } as DashboardCollection;

/**
 * The tree `user` sees with each menu stacked as a layer, the last one closest.
 */
async function resolve(
  layers: Menu[],
  collections: DashboardCollection[] = [posts, tags],
): Promise<DashboardMenuItem[]> {
  layers.forEach((menu, at) => {
    useLayers().add({ path: `/menu-test-${at}`, input: { dashboard: { menu } } });
  });
  try {
    return await resolveDashboardMenu(user, collections);
  } finally {
    layers.forEach((_, at) => useLayers().remove(`/menu-test-${at}`));
  }
}

/**
 * The tree as ids, each group as `{ id: children }`.
 */
function outline(menu: DashboardMenuItem[]): Outline {
  return menu.map((node) => (node.children ? { [node.id]: outline(node.children) } : node.id));
}

const base: Menu = {
  general: { order: 1 },
  collections: { order: 2, label: 'Collections' },
  overview: { parent: 'general', order: 1, to: '/overview', label: 'Overview' },
};

describe('resolveDashboardMenu', () => {
  it('places each collection under `collections`, or at the root without one', async () => {
    deepStrictEqual(outline(await resolve([base])), [
      { general: ['overview'] },
      { collections: ['Posts', 'Tags'] },
    ]);
    deepStrictEqual(outline(await resolve([])), ['Posts', 'Tags']);
  });

  it("resolves a collection's node to its list route, label and icon", async () => {
    deepStrictEqual((await resolve([]))[0], {
      id: 'Posts',
      label: 'Posts',
      to: '/collections/posts',
      icon: 'news',
    });
  });

  it("labels a collection's node with the collection's declared label", async () => {
    const label = { key: 'menuTest.reports', params: { n: 1 } } as const;
    const [node] = await resolve([], [{ ...posts, label }]);
    deepStrictEqual(node?.label, label);
  });

  it('lets a closer layer move, reorder and relabel a node by id', async () => {
    const menu = await resolve([
      { ...base, reports: { parent: 'general', order: 2, to: '/reports', label: 'Reports' } },
      { overview: { order: 3 }, Posts: { parent: 'general' }, reports: { label: 'Stats' } },
    ]);
    deepStrictEqual(outline(menu), [
      { general: ['reports', 'overview', 'Posts'] },
      { collections: ['Tags'] },
    ]);
    deepStrictEqual(menu[0].children?.[0], { id: 'reports', label: 'Stats', to: '/reports' });
  });

  it("replaces a deeper layer's message label whole, its params with it", async () => {
    const menu = await resolve(
      [
        { reports: { to: '/reports', label: { key: 'menuTest.reports', params: { n: 1 } } } },
        { reports: { label: { key: 'menuTest.stats', params: { m: 2 } } } },
      ],
      [],
    );
    deepStrictEqual(menu, [
      { id: 'reports', label: { key: 'menuTest.stats', params: { m: 2 } }, to: '/reports' },
    ]);
  });

  it('moves a node to the root with `parent: null`, over an inherited parent', async () => {
    deepStrictEqual(outline(await resolve([base, { overview: { parent: null } }])), [
      'overview',
      { collections: ['Posts', 'Tags'] },
    ]);
  });

  it('hides a node with its subtree, and a closer layer reveals it again', async () => {
    const shop: Menu = {
      shop: { label: 'Shop' },
      sales: { parent: 'shop', to: '/sales', label: 'Sales' },
      Posts: { parent: 'shop' },
    };
    deepStrictEqual(outline(await resolve([shop, { shop: { hidden: true } }])), ['Tags']);
    deepStrictEqual(
      outline(await resolve([shop, { shop: { hidden: true } }, { shop: { hidden: false } }])),
      [{ shop: ['sales', 'Posts'] }, 'Tags'],
    );
  });

  it('drops a node whose `can` the user lacks, and its subtree', async () => {
    const menu: Menu = {
      reports: { to: '/reports', label: 'Reports', can: 'reports.read' },
      audit: { to: '/audit', label: 'Audit', can: 'audit.read' },
      log: { parent: 'audit', to: '/audit/log', label: 'Log' },
    };
    deepStrictEqual(outline(await resolve([menu])), ['reports', 'Posts', 'Tags']);
  });

  it('drops a group left with no node, and keeps a link without one', async () => {
    const menu: Menu = {
      empty: { label: 'Empty' },
      shell: { label: 'Shell' },
      hiddenLink: { parent: 'shell', to: '/gone', label: 'Gone', hidden: true },
      lone: { to: '/lone', label: 'Lone' },
    };
    deepStrictEqual(outline(await resolve([menu], [])), ['lone']);
  });

  it('drops a declared collection out of reach, or disabled, with its subtree', async () => {
    useLayers().add({ path: '/menu-test-disable', input: { disable: { collections: ['Gone'] } } });
    try {
      const menu: Menu = {
        Secret: {},
        secretLog: { parent: 'Secret', to: '/secret/log', label: 'Log' },
        Gone: {},
        goneLog: { parent: 'Gone', to: '/gone/log', label: 'Log' },
      };
      deepStrictEqual(outline(await resolve([menu], [posts])), ['Posts']);
    } finally {
      useLayers().remove('/menu-test-disable');
    }
  });

  it('keeps equal orders in declaration order, deepest layer first, a patch never moving a node', async () => {
    const menu = await resolve(
      [
        { first: { order: 1, to: '/first', label: 'First' }, zeta: { to: '/z', label: 'Z' } },
        { alpha: { to: '/a', label: 'A' }, zeta: { label: 'Zeta' } },
      ],
      [],
    );
    deepStrictEqual(outline(menu), ['first', 'zeta', 'alpha']);
  });

  it('sorts a collection no layer places after the declared nodes, by name', async () => {
    const menu: Menu = { zeta: { to: '/z', label: 'Z' }, Tags: { order: 10 } };
    deepStrictEqual(outline(await resolve([menu])), ['zeta', 'Tags', 'Posts']);
  });

  it('labels an untitled group by its id below the root, and leaves a root one untitled', async () => {
    const menu = await resolve(
      [
        {
          outer: {},
          'release-notes': { parent: 'outer' },
          latest: { parent: 'release-notes', to: '/notes', label: 'Latest' },
        },
      ],
      [],
    );
    deepStrictEqual(menu, [
      {
        id: 'outer',
        label: '',
        children: [
          {
            id: 'release-notes',
            label: 'Release notes',
            children: [{ id: 'latest', label: 'Latest', to: '/notes' }],
          },
        ],
      },
    ]);
  });

  it('builds a fresh tree on every call, so a hook that mutates it leaks nothing', async () => {
    hook('dashboard:menu', (menu) => {
      menu.push({ id: 'extra', label: 'Extra', to: '/extra' });
      menu[0].label = 'Mutated';
    });
    try {
      await resolve([base]);
      const menu = await resolve([base]);
      deepStrictEqual(outline(menu), [
        { general: ['overview'] },
        { collections: ['Posts', 'Tags'] },
        'extra',
      ]);
    } finally {
      useHooks().delete('dashboard:menu');
    }
  });
});
