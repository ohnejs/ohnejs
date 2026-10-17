import { deepStrictEqual, strictEqual } from 'node:assert';
import { registerHooks } from 'node:module';
import { before, describe, it, mock } from 'node:test';

import type { DashboardField } from '../../../../src/dashboard/runtime/meta-types.ts';

import { loadLanguage } from '../../../../src/dashboard/runtime/messages.ts';
import { flush } from '../../../../src/utils/reactive/_scheduler.ts';
import { effectScope } from '../../../../src/utils/reactive/effect-scope.ts';
import { baseBrowser } from '../../../base/dashboard/_browser.ts';
import { type FakeElement, findElement, hasClass } from '../../../dashboard/_fake-dom.ts';
import { fire } from '../../../dashboard/ui/_events.ts';

type MediaListControl =
  typeof import('../../../../src/uploads/dashboard/components/_media-list-control.ts');

const base = new URL('../../../../src/base/dashboard/', import.meta.url);

registerHooks({
  resolve: (specifier, context, next) =>
    next(
      specifier.startsWith('app/') ? new URL(specifier.slice(4), base).href : specifier,
      context,
    ),
});

const ADMIN = {
  UUID: 'u',
  email: 'admin@example.com',
  roles: ['admin'],
  dashboardLanguage: null,
  contentLanguage: null,
  timezone: null,
  dateFormat: 'YYYY-MM-DD',
  timeFormat: 'HH:mm',
  smartClipboard: false,
};

const UPLOADS = {
  name: 'Uploads',
  segment: 'uploads',
  label: 'Uploads',
  translatable: false,
  singleton: false,
  duplicable: false,
  operations: {
    read: { allowed: true, public: false, scoped: false },
    create: null,
    update: null,
    delete: null,
  },
  fields: [],
  labelFields: ['name'],
};

const DOWNLOADS: DashboardField = {
  name: 'downloads',
  type: 'files',
  kind: 'childMany',
  label: 'Downloads',
  nullable: false,
  required: false,
  unique: false,
  translatable: false,
  readable: true,
  writable: true,
  immutable: false,
  options: {},
};

const record = (uuid: string) => ({
  UUID: uuid,
  kind: 'file',
  private: false,
  directory: '',
  name: `${uuid}.pdf`,
  type: 'application/pdf',
  size: 1,
  hash: null,
  width: null,
  height: null,
  description: null,
  focalX: null,
  focalY: null,
  author: null,
  uploadedAt: 0,
  _updatedAt: 0,
  path: `${uuid}.pdf`,
  url: `/uploads/${uuid}.pdf`,
});

async function settle(): Promise<void> {
  for (let i = 0; i < 3; i++) await new Promise((resolve) => setImmediate(resolve));
  flush();
}

describe('mediaListControl', () => {
  let mediaListControl!: MediaListControl['mediaListControl'];

  before(async () => {
    baseBrowser('/collections/showcase/u1');
    Object.assign(document.body.style, { removeProperty() {}, setProperty() {} });
    Object.assign(document, {
      getElementById: () => ({
        textContent: JSON.stringify({
          apiURL: 'http://api',
          defaultLanguage: 'en',
          messageGroups: [],
        }),
      }),
    });
    mock.method(globalThis, 'fetch', async (url: string, init?: RequestInit) => {
      if (url.endsWith('/dashboard')) {
        const meta = { collections: [UPLOADS], locales: [], menu: [], blocks: [], routes: [] };
        return Response.json(meta);
      }
      if (url.endsWith('/collections/uploads/query')) {
        const body = JSON.parse(String(init?.body)) as { where: { UUID: { in: string[] } } };
        return Response.json(body.where.UUID.in.map(record));
      }
      return Response.json(ADMIN);
    });
    await loadLanguage('en');
    const { sessionUser } = await import('../../../../src/dashboard/runtime/session.ts');
    const { dashboardMeta } = await import('../../../../src/dashboard/runtime/meta.ts');
    sessionUser();
    await settle();
    dashboardMeta();
    await settle();
    ({ mediaListControl } =
      await import('../../../../src/uploads/dashboard/components/_media-list-control.ts'));
  });

  it('restores a list in place, keeping the chips field, and lands a chip removal as a discrete change', async () => {
    await effectScope().run(async () => {
      const seen: (boolean | undefined)[] = [];
      const downloads = mediaListControl(false)({
        field: DOWNLOADS,
        initial: ['f1', 'f2'],
        mode: 'edit',
        path: 'downloads',
        language: () => 'en',
        onInput: (discrete) => seen.push(discrete),
      })!;
      await settle();
      const chips = findElement(downloads.element as unknown as FakeElement, (element) =>
        hasClass(element, 'ohne-dynamic-chips'),
      );
      downloads.restore?.(['f2']);
      await settle();
      deepStrictEqual(downloads.read(), { value: ['f2'] });
      strictEqual(downloads.dirty(), true);
      deepStrictEqual(seen, []);
      strictEqual(
        findElement(downloads.element as unknown as FakeElement, (element) =>
          hasClass(element, 'ohne-dynamic-chips'),
        ),
        chips,
      );
      downloads.restore?.(['f1', 'f2']);
      await settle();
      strictEqual(downloads.dirty(), false);
      const remove = findElement(downloads.element as unknown as FakeElement, (element) =>
        hasClass(element, 'ohne-dynamic-chips-remove'),
      ) as FakeElement;
      fire(remove, 'click');
      flush();
      deepStrictEqual(seen, [true]);
      deepStrictEqual(downloads.read(), { value: ['f2'] });
    });
  });
});
