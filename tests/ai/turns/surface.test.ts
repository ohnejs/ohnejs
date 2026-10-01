import { deepStrictEqual, match, ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { Config } from '../../../src/ohne/layers/config.ts';

import { AI_DEFAULTS } from '../../../src/ai/config.ts';
import { renderSurface } from '../../../src/ai/turns/surface.ts';
import { requireUser } from '../../../src/base/auth/require-user.ts';
import { useCollections } from '../../../src/ohne/collections/use-collections.ts';
import { hook } from '../../../src/ohne/hooks/hook.ts';
import { useHooks } from '../../../src/ohne/hooks/use-hooks.ts';
import { useSearchParams } from '../../../src/ohne/http/use-search-params.ts';
import { useLayers } from '../../../src/ohne/layers/use-layers.ts';
import { queryUntyped } from '../../../src/ohne/query/query.ts';
import { useRoutes } from '../../../src/ohne/routes/use-routes.ts';
import { useSkills } from '../../../src/ohne/skills/use-skills.ts';
import { call, route, signIn, withAI } from '../_fixture.ts';

interface Rendered {
  text: string;
  routes: string[];
  collections: string[];
  pages: string[];
}

const SURFACE = route('POST', '/surface', async (): Promise<Rendered> => {
  const params = useSearchParams();
  const tiers = params.tiers === undefined ? undefined : String(params.tiers).split(',');
  const surface = await renderSurface(
    await requireUser(),
    params.blind === undefined,
    tiers as ('read' | 'write' | 'destructive')[] | undefined,
  );
  return {
    text: surface.text,
    routes: [...surface.routes.keys()].toSorted(),
    collections: [...surface.collections.keys()],
    pages: [...surface.pages.keys()],
  };
});

useSkills().register('retire-characters', {
  name: 'retire-characters',
  skill: {
    description: 'Retire old characters.',
    prompt: 'Retire.',
    capability: 'collection.Characters.update',
  },
});
useSkills().register('weekly-report', {
  name: 'weekly-report',
  skill: { description: 'Sum up the week.', prompt: 'Report.' },
});
useRoutes().register('POST /search', {
  method: 'POST',
  pattern: '/search',
  file: '/search.post.ts',
  layer: 'ohnejs/base',
  handler: () => null,
});
useRoutes().register('GET /reports', {
  method: 'GET',
  pattern: '/reports',
  file: '/reports.get.ts',
  layer: 'app',
  handler: () => null,
});

const officer = await signIn('officer@surface.example.com', ['officer']);
const asker = await signIn('asker@surface.example.com', ['asker']);
const admin = await signIn('admin@surface.example.com', ['admin']);

/**
 * The surface as rendered for the person `token` signs in, for a model that sees values unless `blind`.
 */
async function surfaceFor(token: string, blind = false, tiers?: string[]): Promise<Rendered> {
  const query = [blind ? 'blind' : '', tiers === undefined ? '' : `tiers=${tiers.join(',')}`]
    .filter((part) => part !== '')
    .join('&');
  const { response } = await call(SURFACE, {
    path: query === '' ? '/surface' : `/surface?${query}`,
    token,
  });
  strictEqual(response.status, 200);
  return (await response.json()) as Rendered;
}

const BLIND_DATA =
  'Data: you receive status, counts and ids only, never a field value; you can find, count and change records, never read or translate them.';
const NOTHING_REWRITABLE = 'Rewritable: nothing; you cannot translate or rewrite text here.';

const ITEMS_READ = [
  'GET /collections/items/[uuid]',
  'GET /collections/items/[uuid]/translations',
  'POST /collections/items/query',
  'POST /collections/items/verdicts',
];
const CHARACTERS = [
  'DELETE /collections/characters/[uuid]',
  'GET /collections/characters/[uuid]',
  'PATCH /collections/characters/[uuid]',
  'POST /collections/characters',
  'POST /collections/characters/query',
  'POST /collections/characters/verdicts',
];
const GUILDS_READ = [
  'GET /collections/guilds/[uuid]',
  'POST /collections/guilds/query',
  'POST /collections/guilds/verdicts',
];

describe('renderSurface', () => {
  it('offers the routes of the table the person may run, per collection they reach', async () => {
    await withAI(undefined, async () => {
      const { routes, collections } = await surfaceFor(officer.token);
      deepStrictEqual(
        routes,
        [
          ...CHARACTERS,
          ...GUILDS_READ,
          ...ITEMS_READ,
          'PATCH /collections/items/[uuid]',
          'POST /collections/items/[uuid]/translations/copy',
          'POST /search',
        ].toSorted(),
      );
      deepStrictEqual(collections, ['Items', 'Guilds', 'Characters']);
    });
  });

  it('offers only the routes of the tiers a flow node opens', async () => {
    await withAI(undefined, async () => {
      const { routes, text } = await surfaceFor(officer.token, false, ['read']);
      deepStrictEqual(
        routes,
        [
          ...CHARACTERS.filter(
            (id) => id.startsWith('GET') || id.startsWith('POST /collections/characters/'),
          ),
          ...GUILDS_READ,
          ...ITEMS_READ,
          'POST /search',
        ].toSorted(),
      );
      ok(!text.includes('PATCH /collections/items/[uuid]'));
      const { routes: writes } = await surfaceFor(officer.token, false, ['write', 'destructive']);
      ok(!writes.some((id) => id.startsWith('GET') || id.endsWith('/query')));
      ok(writes.includes('PATCH /collections/characters/[uuid]'));
      ok(writes.includes('DELETE /collections/characters/[uuid]'));
    });
  });

  it('offers nothing to a person who reaches no collection', async () => {
    await withAI(undefined, async () => {
      const { text, routes, collections } = await surfaceFor(asker.token);
      deepStrictEqual(routes, []);
      deepStrictEqual(collections, []);
      match(text, /# Your routes\n\(none\)/);
      ok(!text.includes('# Your collections'));
    });
  });

  it('never offers a denied collection, whatever the person may do with it', async () => {
    await withAI(undefined, async () => {
      const { routes, collections } = await surfaceFor(admin.token);
      ok(routes.includes('DELETE /collections/items/[uuid]'));
      ok(routes.includes('DELETE /collections/items/[uuid]/translations'));
      ok(!routes.some((id) => /\/(users|sessions|ai-turns)\b/.test(id)));
      deepStrictEqual(collections, ['Items', 'Guilds', 'Characters']);
    });
    const denied = [...AI_DEFAULTS.deny.collections, 'Guilds'];
    await withAI({ deny: { collections: denied } }, async () => {
      const { routes, collections } = await surfaceFor(officer.token);
      ok(!routes.some((id) => id.includes('/guilds')));
      deepStrictEqual(collections, ['Items', 'Characters']);
    });
  });

  it('describes the app, each collection and its reachable fields, and the skills', async () => {
    await withAI(undefined, async () => {
      const { text } = await surfaceFor(officer.token);
      match(
        text,
        /^# This app\nLocales: en \(default\), de\.\nLimits: perPage at most 500\. At most 50 requests per step, 200 records per transform\. The person approves every write\.\nData: /,
      );
      ok(text.includes(`\n${BLIND_DATA}\n${NOTHING_REWRITABLE}\n`));
      ok(
        text.includes(
          '## Characters (`characters`): query, create, update, delete.\nLabel: name.\n',
        ),
      );
      ok(text.includes('- name: text, required, unique\n'));
      ok(text.includes('- level: integer, 1 to 60\n'));
      ok(text.includes('- status: select: active | retired\n'));
      ok(text.includes('- guild: record -> Guilds, nullable\n'));
      ok(text.includes('- owner: record -> Users, nullable\n'));
      ok(text.includes('- lastLogin: dateTime, nullable (epoch ms) - When they last played'));
      ok(text.includes('## Items (`items`): query, update.\nLabel: name. Translatable.\n'));
      ok(text.includes('- name: text, required, translatable\n'));
      ok(text.includes('- tooltip: text, nullable, translatable\n'));
      ok(!text.includes('secret'));
      ok(!text.includes('UUID:'));
      ok(text.includes('## Guilds (`guilds`): query.\n'));
      ok(
        text.includes(
          '# Skills\n- retire-characters: Retire old characters.\n- weekly-report: Sum up the week.',
        ),
      );
      const { text: askers } = await surfaceFor(asker.token);
      ok(askers.includes('# Skills\n- weekly-report: Sum up the week.'));
      ok(!askers.includes('retire-characters'));
    });
  });

  it('names the opened collections and fields in the data line and per collection', async () => {
    await withAI(
      { data: { Items: true, Characters: ['name', 'level'], Guilds: true } },
      async () => {
        const { text } = await surfaceFor(officer.token);
        ok(
          text.includes(
            '\nData: you receive field values from Items (name, tooltip, rarity), Guilds (name), and Characters (name, level). From every other collection you receive status, counts and ids only; you can find, count and change such records, never read or translate them.\n',
          ),
        );
        ok(text.includes('\nRewritable: Items (name, tooltip) and Characters (name).\n'));
        ok(
          text.includes(
            '## Items (`items`): query, update.\nLabel: name. Translatable. Data: name, tooltip, rarity. Rewritable: name, tooltip.\n',
          ),
        );
        ok(
          text.includes(
            '## Characters (`characters`): query, create, update, delete.\nLabel: name. Data: name, level. Rewritable: name.\n',
          ),
        );
        ok(!text.includes('secret'));
        const { text: blind } = await surfaceFor(officer.token, true);
        ok(blind.includes(`\n${BLIND_DATA}\n${NOTHING_REWRITABLE}\n`));
        ok(!blind.includes('Data: name'));
        const { text: askers } = await surfaceFor(asker.token);
        ok(askers.includes(`\n${BLIND_DATA}\n${NOTHING_REWRITABLE}\n`));
      },
    );
    const entry = { provider: 'anthropic', model: 'x', key: false } as const;
    await withAI(
      { data: { Items: true }, transform: { model: 'seeing' }, models: { seeing: entry } },
      async () => {
        const { text: blind } = await surfaceFor(officer.token, true);
        ok(blind.includes(`\n${BLIND_DATA}\nRewritable: Items (name, tooltip).\n`));
        ok(blind.includes('Label: name. Translatable. Rewritable: name, tooltip.\n'));
      },
    );
    await withAI({ data: { Items: true, Guilds: true } }, async () => {
      const { text } = await surfaceFor(asker.token);
      ok(text.includes(`\n${NOTHING_REWRITABLE}\n`));
    });
    await withAI({ data: { Items: ['secret'] } }, async () => {
      const { text } = await surfaceFor(officer.token);
      ok(text.includes(`\n${BLIND_DATA}\n`));
      ok(!text.includes('secret'));
    });
  });

  it('states in the limits which writes run without asking, once the person turned it on', async () => {
    const ai = {
      model: 'smart',
      models: { smart: { provider: 'anthropic', model: 'x', key: false } },
      autoAccept: { max: 5, fields: { Items: ['name'], Guilds: true, Characters: true } },
    } satisfies Config['ai'];
    const APPROVES = 'The person approves every write.\n';
    await withAI(ai, async () => {
      ok((await surfaceFor(officer.token)).text.includes(APPROVES));
      await queryUntyped('Users').where({ UUID: officer.uuid }).updateOrThrow({ autoAccept: true });
      try {
        const { text } = await surfaceFor(officer.token);
        ok(
          text.includes(
            ' 200 records per transform. A write whose body names only these fields runs without asking, at most 5 per turn: Items (name) and Characters (every field). Destructive requests, writes by `where`, writes at another locale, and rewrites always ask. The person approves every other write.\n',
          ),
        );
        ok((await surfaceFor(asker.token)).text.includes(APPROVES));
      } finally {
        await queryUntyped('Users')
          .where({ UUID: officer.uuid })
          .updateOrThrow({ autoAccept: false });
      }
    });
    await withAI({ ...ai, autoAccept: { ...ai.autoAccept, ask: [] } }, async () => {
      await queryUntyped('Users').where({ UUID: officer.uuid }).updateOrThrow({ autoAccept: true });
      try {
        ok(
          (await surfaceFor(officer.token)).text.includes(
            ' Writes by `where` and rewrites always ask.',
          ),
        );
      } finally {
        await queryUntyped('Users')
          .where({ UUID: officer.uuid })
          .updateOrThrow({ autoAccept: false });
      }
    });
  });

  it('follows the routes table: a replaced table, an app route, and the hard prefixes', async () => {
    await withAI({ routes: { 'POST /collections/[collection]/query': 'read' } }, async () => {
      deepStrictEqual((await surfaceFor(officer.token)).routes, [
        'POST /collections/characters/query',
        'POST /collections/guilds/query',
        'POST /collections/items/query',
      ]);
    });
    await withAI({ routes: { ...AI_DEFAULTS.routes, 'GET /reports': 'read' } }, async () => {
      ok((await surfaceFor(asker.token)).routes.includes('GET /reports'));
    });
    await withAI({ routes: { '/**': 'read' } }, async () => {
      const { routes } = await surfaceFor(admin.token);
      ok(routes.includes('GET /reports'));
      ok(!routes.some((id) => id.includes('/auth/') || id.includes('/ai/')));
    });
  });

  it('offers the search and tells the model how to use it', async () => {
    await withAI(undefined, async () => {
      const { text, routes } = await surfaceFor(officer.token);
      ok(routes.includes('POST /search'));
      match(text, /`POST \/search` with `\{ q \}` finds records holding every word/);
      match(text, /A result with `via` did not match on its own/);
      match(text, /Page a related group with `collection` and `via`\./);
      match(text, /A whole UUID finds that record and the records that link to it\./);
      match(text, /`limit` \(default 5, at most 50\)/);
    });
  });

  it('lists the sidebar rows and the account page under `# Your pages`', async () => {
    await withAI(undefined, async () => {
      const { text, pages } = await surfaceFor(officer.token);
      deepStrictEqual(pages, [
        '/overview',
        '/collections/items',
        '/collections/guilds',
        '/collections/characters',
        '/account',
      ]);
      match(text, /\n# Your pages\n- \/overview: .+\n- \/collections\/items: Items\n/);
      ok(text.indexOf('# Your routes') < text.indexOf('# Your pages'));
    });
  });

  it('drops a link off this origin, a closed page, and the rows of a denied collection', async () => {
    const menu = {
      items: [
        'Guilds',
        'Items',
        { to: 'https://docs.example.com', label: 'Docs' },
        { to: '//evil.example.com', label: 'Evil' },
        { to: '/logout?next=/', label: 'Sign out' },
        { to: '/collections/guilds/archive', label: 'Archive' },
        { to: '/reports?range=week', label: 'Weekly' },
        { to: '/collections/items', label: 'Items again' },
      ],
    };
    const ai = { deny: { collections: [...AI_DEFAULTS.deny.collections, 'Guilds'] } };
    useLayers().add({ path: '/pages-test/app', input: { ai, dashboard: { menu: [menu] } } });
    try {
      const { text, pages } = await surfaceFor(officer.token);
      deepStrictEqual(pages, [
        '/collections/items',
        '/reports?range=week',
        '/collections/characters',
        '/account',
      ]);
      ok(text.includes('- /collections/items: Items\n'));
    } finally {
      useLayers().remove('/pages-test/app');
    }
  });

  it("drops the page a denied collection's `recordPath` opens, wherever a hook puts it", async () => {
    const guilds = useCollections().get('Guilds')!.collection;
    const dashboard = guilds.dashboard;
    guilds.dashboard = { ...dashboard, recordPath: '/guilds?details=[uuid]' };
    hook('dashboard:menu', (menu) => [
      ...menu,
      { label: '', items: [{ to: '/guilds', label: 'Guild hall' }] },
    ]);
    const ai = { deny: { collections: [...AI_DEFAULTS.deny.collections, 'Guilds'] } };
    try {
      await withAI(ai, async () => {
        ok(!(await surfaceFor(officer.token)).pages.includes('/guilds'));
      });
      await withAI(undefined, async () => {
        ok((await surfaceFor(officer.token)).pages.includes('/guilds'));
      });
    } finally {
      guilds.dashboard = dashboard;
      useHooks().delete('dashboard:menu');
    }
  });

  it('lists a row the `dashboard:menu` hook adds or rewrites', async () => {
    hook('dashboard:menu', (menu) => [
      ...menu.map((group) => ({
        ...group,
        items: group.items.map((item) =>
          item.to === '/collections/items' ? { ...item, to: '/media' } : item,
        ),
      })),
      { label: '', items: [{ to: '/audit', label: 'Audit' }] },
    ]);
    try {
      await withAI(undefined, async () => {
        const { text, pages } = await surfaceFor(officer.token);
        ok(pages.includes('/media'));
        ok(!pages.includes('/collections/items'));
        ok(text.includes('- /audit: Audit'));
      });
    } finally {
      useHooks().delete('dashboard:menu');
    }
  });
});
