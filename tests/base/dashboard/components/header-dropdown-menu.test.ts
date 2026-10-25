import { strictEqual } from 'node:assert';
import { afterEach, before, describe, it } from 'node:test';

import type { DashboardField } from '../../../../src/dashboard/runtime/meta-types.ts';
import type { Sent } from './_popups.ts';

import { startSession } from '../../../../src/dashboard/runtime/_request.ts';
import { dashboardMeta, invalidateDashboardMeta } from '../../../../src/dashboard/runtime/meta.ts';
import { effectScope } from '../../../../src/utils/reactive/effect-scope.ts';
import { type FakeElement, hasClass } from '../../../dashboard/_fake-dom.ts';
import { shapeOfDOM } from '../../../dashboard/ui/_menu-shape.ts';
import { baseBrowser } from '../_browser.ts';
import { body, findAll, fire, idle, metaWith, recordFetch, recordListeners } from './_popups.ts';

const NAME: DashboardField = {
  name: 'name',
  type: 'text',
  kind: 'column',
  logicalType: 'text',
  label: 'Name',
  nullable: false,
  required: false,
  unique: false,
  translatable: false,
  readable: true,
  writable: true,
  immutable: false,
};

describe('headerDropdownMenu', () => {
  let headerDropdownMenu!: typeof import('../../../../src/base/dashboard/components/header-dropdown-menu.ts').headerDropdownMenu;
  let scope: ReturnType<typeof effectScope> | undefined;
  let accountFields: DashboardField[] = [];

  const lastMenu = (): FakeElement =>
    findAll(body(), (element) => element.getAttribute('role') === 'menu').at(-1)!;

  /**
   * Mounts the menu with `fields` as the account fields, once the discovery data lands.
   */
  const mount = async (fields: DashboardField[]): Promise<FakeElement> => {
    accountFields = fields;
    invalidateDashboardMeta();
    dashboardMeta();
    await idle();
    scope = effectScope();
    return scope.run(() => headerDropdownMenu()) as unknown as FakeElement;
  };

  before(async () => {
    baseBrowser('/');
    recordListeners();
    recordFetch([] as Sent[], ({ path }) =>
      path === '/dashboard'
        ? Response.json({ ...metaWith([], []), accountFields })
        : new Response(null, { status: 404 }),
    );
    ({ headerDropdownMenu } =
      await import('../../../../src/base/dashboard/components/header-dropdown-menu.ts'));
    startSession();
  });

  afterEach(() => scope?.dispose());

  it('fences Sign out after the color mode and the account link', async () => {
    fire(await mount([NAME]), 'click');
    strictEqual(
      shapeOfDOM(lastMenu()),
      'dashboard.header.darkMode, dashboard.header.myAccount | dashboard.signOut',
    );
  });

  it('leaves the account link out while there are no account fields', async () => {
    fire(await mount([]), 'click');
    strictEqual(shapeOfDOM(lastMenu()), 'dashboard.header.darkMode | dashboard.signOut');
  });

  it('marks the open trigger expanded instead of turning it primary', async () => {
    const trigger = await mount([]);
    fire(trigger, 'click');
    strictEqual(trigger.getAttribute('aria-expanded'), 'true');
    strictEqual(hasClass(trigger, 'ohne-button-primary'), false);
    fire(trigger, 'click');
    strictEqual(trigger.getAttribute('aria-expanded'), 'false');
  });
});
