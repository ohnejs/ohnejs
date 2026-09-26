import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { DashboardMenuGroup, DashboardMeta } from '../../../src/base/api/dashboard.get.ts';
import type { User } from '../../../src/base/auth/types.ts';

import '../../../src/uploads/boot/hooks.ts';
import { toUser } from '../../../src/base/auth/to-user.ts';
import { useCollections } from '../../../src/ohne/collections/use-collections.ts';
import { buildDesiredSchema } from '../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../src/ohne/database/schema/sync.ts';
import { useDatabase, useDialect } from '../../../src/ohne/database/use-database.ts';
import { field } from '../../../src/ohne/fields/field.ts';
import { useFields } from '../../../src/ohne/fields/use-fields.ts';
import { applyHook } from '../../../src/ohne/hooks/apply-hook.ts';
import { useLayers } from '../../../src/ohne/layers/use-layers.ts';
import { scanLayerMessages } from '../../../src/ohne/messages/scan-layer-messages.ts';
import { useMessages } from '../../../src/ohne/messages/use-messages.ts';
import { queryUntyped } from '../../../src/ohne/query/query.ts';
import { useRoles } from '../../../src/ohne/roles/use-roles.ts';
import { joinPath, parseBytes } from '../../../src/utils/index.ts';
import { storage } from '../_fixture.ts';

const layer = { name: 'uploads', dir: joinPath(import.meta.dirname, '../../../src/uploads') };
const catalog: Record<string, string> = {};
for (const meta of await scanLayerMessages(layer, 'messages')) {
  if (meta.language === 'en') catalog[meta.key] = meta.template;
}
useMessages().register('en', catalog);

useCollections().register('BootPosts', {
  name: 'BootPosts',
  collection: { fields: { cover: field('record', { collection: 'Uploads' }) } },
});
await syncDatabase(useDatabase(), useDialect(), {
  desired: buildDesiredSchema(useCollections(), useFields() as never),
});
useRoles().register('boot-viewer', {
  name: 'boot-viewer',
  role: { capabilities: ['collection.Users.read'] },
});

const admin = toUser({ UUID: 'u-admin', email: 'admin@example.com', roles: ['uploads-admin'] });
const viewer = toUser({ UUID: 'u-viewer', email: 'viewer@example.com', roles: ['boot-viewer'] });

const usersRow = { to: '/collections/users', label: 'Users' };
const uploadsRow = { to: '/collections/uploads', label: 'Uploads', icon: 'library-photo' as const };
const journalRow = { to: '/collections/uploads-journal', label: 'Uploads journal' };
const sessionsRow = { to: '/collections/uploads-sessions', label: 'Uploads sessions' };
const mediaRow = { to: '/media', label: 'Media', icon: 'library-photo' };

const folder = await queryUntyped('Uploads').createOrThrow({
  kind: 'folder',
  directory: '',
  name: 'photos',
});
const sunset = await queryUntyped('Uploads').createOrThrow({
  kind: 'file',
  directory: 'photos',
  name: 'sunset.jpg',
  type: 'image/jpeg',
  size: 6,
});

const SESSION_ROUTES = [
  'POST /uploads/sessions',
  'PATCH /uploads/sessions/[uuid]',
  'POST /uploads/sessions/[uuid]/complete',
];

function menuFor(user: User, ...groups: DashboardMenuGroup[]): Promise<DashboardMenuGroup[]> {
  return applyHook('dashboard:menu', groups, { user, collections: [] });
}

/**
 * The discovery payload the `dashboard:meta` hook leaves for an app serving `routes`.
 */
async function metaFor(routes: string[]): Promise<DashboardMeta> {
  const meta = { routes } as DashboardMeta;
  await applyHook('dashboard:meta', meta, { user: admin });
  return meta;
}

describe('the read hooks', () => {
  it('decorates every Uploads read with path, and a file with url', async () => {
    const rows = await queryUntyped('Uploads').orderBy('name').findMany();
    deepStrictEqual(
      rows.map((row) => [row.path, row.url]),
      [
        ['photos', undefined],
        ['photos/sunset.jpg', '/uploads/photos/sunset.jpg'],
      ],
    );
    const first = await queryUntyped('Uploads').where({ UUID: folder.UUID }).findFirst();
    strictEqual(first?.path, 'photos');
    strictEqual(first?.url, undefined);
  });

  it('decorates a populated Uploads target', async () => {
    const post = await queryUntyped('BootPosts').createOrThrow({ cover: sunset.UUID });
    const read = await queryUntyped('BootPosts')
      .where({ UUID: post.UUID })
      .populate('cover')
      .findFirst();
    const cover = read?.cover as Record<string, unknown>;
    strictEqual(cover.path, 'photos/sunset.jpg');
    strictEqual(cover.url, '/uploads/photos/sunset.jpg');
  });
});

describe('the dashboard:menu hook', () => {
  it('rewrites the Uploads row into the media row where it stands', async () => {
    const menu = await menuFor(admin, { label: 'Content', items: [usersRow, uploadsRow] });
    deepStrictEqual(menu, [{ label: 'Content', items: [usersRow, mediaRow] }]);
  });

  it('appends the media row for a viewer who may read Uploads but has no row', async () => {
    const menu = await menuFor(admin, { label: '', items: [usersRow] });
    deepStrictEqual(menu, [
      { label: '', items: [usersRow] },
      { label: '', items: [mediaRow] },
    ]);
  });

  it('leaves the menu alone for a viewer without the capability', async () => {
    const menu = await menuFor(viewer, { label: '', items: [usersRow] });
    deepStrictEqual(menu, [{ label: '', items: [usersRow] }]);
  });

  it('drops the journal and sessions rows, and the group they leave empty', async () => {
    const menu = await menuFor(
      admin,
      { label: 'System', items: [journalRow, sessionsRow] },
      { label: '', items: [usersRow, sessionsRow, uploadsRow] },
    );
    deepStrictEqual(menu, [{ label: '', items: [usersRow, mediaRow] }]);
  });

  it('keeps a declared /media link and appends nothing beside it', async () => {
    const library = { to: '/media', label: 'Library', icon: 'photo' as const };
    const menu = await menuFor(
      admin,
      { label: 'Content', items: [library] },
      { label: '', items: [uploadsRow] },
    );
    deepStrictEqual(menu, [
      { label: 'Content', items: [library] },
      { label: '', items: [mediaRow] },
    ]);
    deepStrictEqual(await menuFor(admin, { label: '', items: [library] }), [
      { label: '', items: [library] },
    ]);
  });
});

describe('the dashboard:meta hook', () => {
  it('leaves whether a route is served to the framework', async () => {
    strictEqual('uploadFromURL' in (await metaFor(SESSION_ROUTES)), false);
  });

  it('sends the upload limits in bytes, with a chunk size while the routes that open, fill and complete a session are served', async () => {
    useLayers().add({
      path: '/boot-hooks-limits',
      input: { uploads: { maxFileSize: '10gb', chunkSize: '16mb' } },
    });
    try {
      deepStrictEqual((await metaFor(['POST /uploads', ...SESSION_ROUTES])).uploads, {
        maxFileSize: parseBytes('10gb'),
        chunkSize: parseBytes('16mb'),
      });
    } finally {
      useLayers().remove('/boot-hooks-limits');
    }
  });

  it('counts one of the routes that open, fill and complete a session when it answers every method', async () => {
    const routes = ['/uploads/sessions', ...SESSION_ROUTES.slice(1)];
    strictEqual((await metaFor(routes)).uploads?.chunkSize, parseBytes('8mb'));
  });

  it('sends no chunk size while the app drops one of the routes that open, fill and complete a session', async () => {
    for (const dropped of SESSION_ROUTES) {
      const meta = await metaFor(SESSION_ROUTES.filter((id) => id !== dropped));
      deepStrictEqual(meta.uploads, { maxFileSize: parseBytes('128mb') });
    }
  });

  it('sends no chunk size on a storage without parts', async () => {
    const { parts } = storage;
    delete storage.parts;
    try {
      deepStrictEqual((await metaFor(SESSION_ROUTES)).uploads, {
        maxFileSize: parseBytes('128mb'),
      });
    } finally {
      storage.parts = parts;
    }
  });
});
