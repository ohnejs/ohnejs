import { deepStrictEqual, strictEqual } from 'node:assert';
import { afterEach, before, describe, it } from 'node:test';

import type {
  DashboardCollection,
  DashboardField,
} from '../../../../src/dashboard/runtime/meta-types.ts';
import type { Sent } from './_popups.ts';

import { startSession } from '../../../../src/dashboard/runtime/_request.ts';
import { dashboardMeta, invalidateDashboardMeta } from '../../../../src/dashboard/runtime/meta.ts';
import { effectScope } from '../../../../src/utils/reactive/effect-scope.ts';
import { type FakeElement, hasClass } from '../../../dashboard/_fake-dom.ts';
import { shapeOfDOM } from '../../../dashboard/ui/_menu-shape.ts';
import { baseBrowser } from '../_browser.ts';
import { body, findAll, fire, idle, metaWith, recordFetch, recordListeners } from './_popups.ts';

const field = (name: string): DashboardField => ({
  name,
  type: 'text',
  kind: 'column',
  logicalType: 'text',
  label: name,
  nullable: false,
  required: false,
  unique: false,
  translatable: false,
  readable: true,
  writable: true,
  immutable: false,
});

const allowed = { allowed: true, public: false, scoped: false };

const RAIDERS: DashboardCollection = {
  name: 'Raiders',
  segment: 'raiders',
  label: 'Raiders',
  translatable: false,
  singleton: false,
  duplicable: true,
  operations: { read: allowed, create: null, update: null, delete: null },
  fields: [field('name')],
  labelFields: ['name'],
  table: { columns: ['name'] },
};

const RECORDS = [
  { UUID: 'u-thrall', name: 'Thrall' },
  { UUID: 'u-jaina', name: 'Jaina' },
];

describe('dataTablePopup row menu', () => {
  let dataTablePopup!: typeof import('../../../../src/base/dashboard/components/data-table-popup.ts').dataTablePopup;
  let scope: ReturnType<typeof effectScope> | undefined;
  const sent: Sent[] = [];
  const applied: string[][] = [];

  /**
   * Opens the picker over the raiders, in `multiple` mode or single, and lets its page load.
   */
  const open = async (collection: DashboardCollection, multiple: boolean): Promise<void> => {
    scope = effectScope();
    scope.run(() =>
      dataTablePopup({
        collection,
        title: 'Raiders',
        values: [],
        multiple,
        onApply: (uuids) => applied.push(uuids),
        onClose: () => {},
      }),
    );
    await idle();
  };

  const rowOf = (name: string): FakeElement =>
    findAll(
      body(),
      (element) => element.tagName === 'TR' && element.textContent.includes(name),
    )[0]!;

  const lastMenu = (): FakeElement =>
    findAll(body(), (element) => element.getAttribute('role') === 'menu').at(-1)!;

  /**
   * The shape of the row's menu through its kebab, then asserted equal through a right-click.
   */
  const shape = (name: string): string => {
    const kebab = findAll(rowOf(name), (element) => hasClass(element, 'ohne-table-kebab'))[0]!;
    fire(kebab, 'click');
    const viaKebab = shapeOfDOM(lastMenu());
    fire(kebab, 'click');
    fire(rowOf(name), 'contextmenu', { clientX: 0, clientY: 0 });
    strictEqual(shapeOfDOM(lastMenu()), viaKebab);
    return viaKebab;
  };

  const pick = (name: string, label: string): void => {
    fire(rowOf(name), 'contextmenu', { clientX: 0, clientY: 0 });
    const row = findAll(
      lastMenu(),
      (element) => element.getAttribute('role') === 'menuitem' && element.textContent === label,
    )[0]!;
    fire(row, 'click');
  };

  before(async () => {
    baseBrowser('/collections/posts');
    recordListeners();
    recordFetch(sent, ({ path, body: request }) => {
      if (path === '/dashboard') return Response.json(metaWith([], []));
      const { page } = request as { page: number };
      return Response.json({ records: RECORDS, page, lastPage: 1, perPage: 50, total: 2 });
    });
    ({ dataTablePopup } =
      await import('../../../../src/base/dashboard/components/data-table-popup.ts'));
    startSession();
    invalidateDashboardMeta();
    dashboardMeta();
    await idle();
  });

  afterEach(() => {
    scope?.dispose();
    sent.length = 0;
    applied.length = 0;
  });

  const rights: [string, DashboardCollection['operations']][] = [
    ['read', RAIDERS.operations],
    ['every right', { read: allowed, create: allowed, update: allowed, delete: allowed }],
  ];

  for (const [name, operations] of rights) {
    it(`offers Select and Open in new tab in one group, with ${name}`, async () => {
      for (const multiple of [false, true]) {
        await open({ ...RAIDERS, operations }, multiple);
        strictEqual(shape('Jaina'), 'dashboard.select, dashboard.openInNewTab');
        scope?.dispose();
      }
    });
  }

  it('asks no row verdicts', async () => {
    await open(
      { ...RAIDERS, operations: { ...RAIDERS.operations, update: { ...allowed, scoped: true } } },
      false,
    );
    deepStrictEqual(
      sent.map((request) => request.path),
      ['/collections/raiders/query'],
    );
  });

  it('turns Select into Deselect on a selected row in multiple mode', async () => {
    await open(RAIDERS, true);
    pick('Jaina', 'dashboard.select');
    strictEqual(shape('Jaina'), 'dashboard.deselect, dashboard.openInNewTab');
    strictEqual(shape('Thrall'), 'dashboard.select, dashboard.openInNewTab');
    pick('Jaina', 'dashboard.deselect');
    strictEqual(shape('Jaina'), 'dashboard.select, dashboard.openInNewTab');
  });

  it('picks the row at once through Select in single mode', async () => {
    await open(RAIDERS, false);
    pick('Thrall', 'dashboard.select');
    deepStrictEqual(applied, [['u-thrall']]);
  });

  it('opens the record page in a new tab', async () => {
    await open(RAIDERS, false);
    fire(rowOf('Jaina'), 'contextmenu', { clientX: 0, clientY: 0 });
    const link = findAll(
      lastMenu(),
      (element) => element.textContent === 'dashboard.openInNewTab',
    )[0]!;
    deepStrictEqual(
      [link.tagName, link.getAttribute('href'), link.getAttribute('target')],
      ['A', '/collections/raiders/u-jaina', '_blank'],
    );
  });
});
