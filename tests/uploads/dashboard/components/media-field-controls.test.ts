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

type MediaControls =
  typeof import('../../../../src/uploads/dashboard/components/media-field-controls.ts');

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

const COVER: DashboardField = {
  name: 'cover',
  type: 'file',
  kind: 'column',
  label: 'Cover',
  nullable: true,
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

describe('mediaControl', () => {
  let mediaControl!: MediaControls['mediaControl'];

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
    ({ mediaControl } =
      await import('../../../../src/uploads/dashboard/components/media-field-controls.ts'));
  });

  it('restores a link in place, dirty against the stored one, and lands a clear as a discrete change', async () => {
    await effectScope().run(async () => {
      const seen: (boolean | undefined)[] = [];
      const cover = mediaControl(false)({
        field: COVER,
        initial: 'f1',
        mode: 'edit',
        path: 'cover',
        language: () => 'en',
        onInput: (discrete) => seen.push(discrete),
      })!;
      await settle();
      cover.restore?.('f2');
      await settle();
      deepStrictEqual(cover.read(), { value: 'f2' });
      strictEqual(cover.dirty(), true);
      deepStrictEqual(seen, []);
      cover.restore?.('f1');
      strictEqual(cover.dirty(), false);
      const clear = findElement(
        cover.element as unknown as FakeElement,
        (element) =>
          hasClass(element, 'ohne-button') &&
          /clear/i.test(element.getAttribute('aria-label') ?? ''),
      ) as FakeElement;
      fire(clear, 'click');
      flush();
      deepStrictEqual(seen, [true]);
      deepStrictEqual(cover.read(), { value: null });
      cover.restore?.(null);
      deepStrictEqual(cover.read(), { value: null });
      strictEqual(cover.dirty(), true);
    });
  });
});
