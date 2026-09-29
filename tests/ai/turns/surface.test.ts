import { deepStrictEqual, match, ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { AI_DEFAULTS } from '../../../src/ai/config.ts';
import { renderSurface } from '../../../src/ai/turns/surface.ts';
import { requireUser } from '../../../src/base/auth/require-user.ts';
import { useSearchParams } from '../../../src/ohne/http/use-search-params.ts';
import { useRoutes } from '../../../src/ohne/routes/use-routes.ts';
import { useSkills } from '../../../src/ohne/skills/use-skills.ts';
import { call, route, signIn, withAI } from '../_fixture.ts';

interface Rendered {
  text: string;
  routes: string[];
  collections: string[];
}

const SURFACE = route('POST', '/surface', async (): Promise<Rendered> => {
  const surface = await renderSurface(await requireUser(), useSearchParams().blind === undefined);
  return {
    text: surface.text,
    routes: [...surface.routes.keys()].toSorted(),
    collections: [...surface.collections.keys()],
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
async function surfaceFor(token: string, blind = false): Promise<Rendered> {
  const { response } = await call(SURFACE, { path: blind ? '/surface?blind' : '/surface', token });
  strictEqual(response.status, 200);
  return (await response.json()) as Rendered;
}

const BLIND_DATA =
  'Data: you receive status, counts and ids only, never a field value; you can find, count and change records, never read or translate them.';

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
        ].toSorted(),
      );
      deepStrictEqual(collections, ['Items', 'Guilds', 'Characters']);
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
        /^# This app\nLocales: en \(default\), de\.\nLimits: perPage at most 500\. At most 50 requests per step\. The person approves every write\.\nData: /,
      );
      ok(text.includes(`\n${BLIND_DATA}\n`));
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
        ok(
          text.includes(
            '## Items (`items`): query, update.\nLabel: name. Translatable. Data: name, tooltip, rarity.\n',
          ),
        );
        ok(
          text.includes(
            '## Characters (`characters`): query, create, update, delete.\nLabel: name. Data: name, level.\n',
          ),
        );
        ok(!text.includes('secret'));
        const { text: blind } = await surfaceFor(officer.token, true);
        ok(blind.includes(`\n${BLIND_DATA}\n`));
        ok(!blind.includes('Data: name'));
        const { text: askers } = await surfaceFor(asker.token);
        ok(askers.includes(`\n${BLIND_DATA}\n`));
      },
    );
    await withAI({ data: { Items: ['secret'] } }, async () => {
      const { text } = await surfaceFor(officer.token);
      ok(text.includes(`\n${BLIND_DATA}\n`));
      ok(!text.includes('secret'));
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
});
