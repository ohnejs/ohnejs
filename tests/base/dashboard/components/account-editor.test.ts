import { deepStrictEqual, strictEqual } from 'node:assert';
import { before, describe, it } from 'node:test';

import type { DashboardField } from '../../../../src/dashboard/runtime/meta-types.ts';

import { effectScope } from '../../../../src/utils/index.ts';
import { flush } from '../../../../src/utils/reactive/_scheduler.ts';
import { FakeElement, findElement, hasClass } from '../../../dashboard/_fake-dom.ts';
import { type } from '../../../dashboard/fields/_controls.ts';
import { settle } from '../../../dashboard/router/_browser.ts';
import { fire } from '../../../dashboard/ui/_events.ts';
import { baseBrowser } from '../_browser.ts';
import { OMEN, registerOmen } from './_omen.ts';

// `baseBrowser` blanks `querySelector`; the controls need the one `_controls.ts` installs.
const { querySelector } = FakeElement.prototype as unknown as { querySelector: unknown };

type Account = typeof import('../../../../src/base/dashboard/components/account-editor.ts');
type Guard = typeof import('../../../../src/dashboard/router/unsaved-changes.ts');

const FIRST_NAME: DashboardField = {
  name: 'firstName',
  type: 'text',
  kind: 'column',
  logicalType: 'text',
  label: 'First name',
  nullable: true,
  required: false,
  unique: false,
  translatable: false,
  readable: true,
  writable: true,
  immutable: false,
  options: {},
};

const SMART_CLIPBOARD: DashboardField = {
  ...FIRST_NAME,
  name: 'smartClipboard',
  type: 'boolean',
  logicalType: 'boolean',
  label: 'Smart clipboard',
  nullable: false,
  options: { display: 'switch' },
};

const ADMIN = {
  UUID: 'u',
  email: 'admin@example.com',
  roles: ['admin'],
  firstName: 'Jaina',
  dashboardLanguage: null,
  contentLanguage: null,
  timezone: null,
  dateFormat: 'YYYY-MM-DD',
  timeFormat: 'HH:mm',
  smartClipboard: false,
};

/**
 * The runtime config for `ohne-config`, and no element under any other id, as the history looks rows up.
 */
function configOnly(id: string): { textContent: string } | null {
  if (id !== 'ohne-config') return null;
  const config = { apiURL: 'http://api', defaultLanguage: 'en', messageGroups: [] };
  return { textContent: JSON.stringify(config) };
}

describe('accountEditor', () => {
  let account!: Account;
  let hasUnsavedChanges!: Guard['hasUnsavedChanges'];

  before(async () => {
    baseBrowser('/account');
    Object.assign(FakeElement.prototype, { querySelector });
    Object.assign(document, { getElementById: configOnly });
    Object.assign(globalThis, {
      ResizeObserver: class {
        observe() {}
        disconnect() {}
      },
      fetch: async (url: string) => {
        if (url.endsWith('/dashboard')) {
          return Response.json({
            collections: [],
            locales: [],
            menu: [],
            blocks: [],
            accountFields: [FIRST_NAME, SMART_CLIPBOARD, OMEN],
          });
        }
        return Response.json(ADMIN);
      },
    });
    await registerOmen();
    account = await import('../../../../src/base/dashboard/components/account-editor.ts');
    ({ hasUnsavedChanges } = await import('../../../../src/dashboard/router/unsaved-changes.ts'));
    const { sessionUser } = await import('../../../../src/dashboard/runtime/session.ts');
    const { dashboardMeta } = await import('../../../../src/dashboard/runtime/meta.ts');
    sessionUser();
    await settle();
    dashboardMeta();
    await settle();
  });

  /**
   * The account page mounted and ready: its first name input, its switch, and its history buttons.
   */
  async function open() {
    const { h } = await import('../../../../src/dashboard/render/h.ts');
    const scope = effectScope();
    const root = scope.run(() => h('div', null, account.accountEditor())) as unknown as FakeElement;
    await settle();
    const byID = (id: string) =>
      findElement(root, (element) => (element as unknown as { id?: string }).id === id)!;
    const step = (label: string) => () => {
      fire(
        findElement(root, (element) =>
          (element.getAttribute('aria-label') ?? '').startsWith(label),
        )!,
        'click',
      );
      flush();
    };
    return {
      scope,
      input: byID('field-firstName-input') as FakeElement & { value: string },
      omen: byID('field-omen-input'),
      knob: findElement(root, (element) =>
        hasClass(element, 'ohne-switch-control'),
      ) as FakeElement & {
        checked: boolean;
      },
      undo: step('dashboard.history.undo'),
      redo: step('dashboard.history.redo'),
    };
  }

  it('lands a toggle after pending typing as its own step, restoring both into the same nodes', async () => {
    const { scope, input, knob, undo, redo } = await open();
    type(input, 'Jaina Proudmoore');
    knob.checked = true;
    fire(knob, 'change');
    flush();
    undo();
    strictEqual(knob.checked, false);
    strictEqual(input.value, 'Jaina Proudmoore');
    undo();
    strictEqual(input.value, 'Jaina');
    strictEqual(
      findElement(input.parentNode!, (element) => element === input),
      input,
    );
    redo();
    redo();
    deepStrictEqual([input.value, knob.checked], ['Jaina Proudmoore', true]);
    scope.dispose();
  });

  it('guards leaving on form dirt the history cannot see', async () => {
    const { scope, omen } = await open();
    type(omen, 'x');
    strictEqual(hasUnsavedChanges(), true);
    scope.dispose();
    strictEqual(hasUnsavedChanges(), false);
  });
});
