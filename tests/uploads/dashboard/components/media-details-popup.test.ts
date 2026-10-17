import { strictEqual } from 'node:assert';
import { registerHooks } from 'node:module';
import { before, describe, it, mock } from 'node:test';

import type { DashboardField } from '../../../../src/dashboard/runtime/meta-types.ts';
import type { UploadRecord } from '../../../../src/uploads/uploads/types.ts';

import { flush } from '../../../../src/utils/reactive/_scheduler.ts';
import { effectScope } from '../../../../src/utils/reactive/effect-scope.ts';
import { baseBrowser } from '../../../base/dashboard/_browser.ts';
import { FakeElement, findElement, hasClass } from '../../../dashboard/_fake-dom.ts';
import { type } from '../../../dashboard/fields/_controls.ts';
import { fire } from '../../../dashboard/ui/_events.ts';

type Popup = typeof import('../../../../src/uploads/dashboard/components/media-details-popup.ts');

const base = new URL('../../../../src/base/dashboard/', import.meta.url);

registerHooks({
  resolve: (specifier, context, next) =>
    next(
      specifier.startsWith('app/') ? new URL(specifier.slice(4), base).href : specifier,
      context,
    ),
});

// `baseBrowser` blanks `querySelector`; the controls need the one `_controls.ts` installs.
const { querySelector } = FakeElement.prototype as unknown as { querySelector: unknown };

const DESCRIPTION: DashboardField = {
  name: 'description',
  type: 'text',
  kind: 'column',
  logicalType: 'text',
  label: 'Description',
  nullable: true,
  required: false,
  unique: false,
  translatable: false,
  readable: true,
  writable: true,
  immutable: false,
  options: {},
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
    update: { allowed: true, public: false, scoped: false },
    delete: null,
  },
  fields: [DESCRIPTION],
  labelFields: ['name'],
};

const RECORD = {
  UUID: 'f1',
  kind: 'file',
  private: false,
  directory: '',
  name: 'loot-rules.pdf',
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
  path: 'loot-rules.pdf',
  url: '/uploads/loot-rules.pdf',
} as unknown as UploadRecord;

/**
 * The runtime config for `ohne-config`, and no element under any other id, as the history looks rows up.
 */
function configOnly(id: string): { textContent: string } | null {
  if (id !== 'ohne-config') return null;
  const config = { apiURL: 'http://api', defaultLanguage: 'en', messageGroups: [] };
  return { textContent: JSON.stringify(config) };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 3; i++) await new Promise((resolve) => setImmediate(resolve));
  flush();
}

describe('mediaDetailsPopup', () => {
  let popup!: Popup;

  before(async () => {
    baseBrowser('/media');
    Object.assign(FakeElement.prototype, { querySelector });
    Object.assign(document.body.style, { removeProperty() {}, setProperty() {} });
    const classes = document.body.classList as unknown as Set<string>;
    Object.assign(classes, { remove: (name: string) => classes.delete(name) });
    Object.assign(document, { getElementById: configOnly });
    Object.assign(window, { dispatchEvent: () => true });
    Object.assign(globalThis, {
      ResizeObserver: class {
        observe() {}
        disconnect() {}
      },
    });
    // The relative upload time ticks on a page-long clock; unref'd, it lets the run exit.
    const tick = globalThis.setInterval;
    mock.method(globalThis, 'setInterval', (...args: Parameters<typeof setInterval>) =>
      tick(...args).unref(),
    );
    mock.method(globalThis, 'fetch', async (url: string) => {
      if (url.endsWith('/dashboard')) {
        return Response.json({
          collections: [UPLOADS],
          locales: [],
          menu: [],
          blocks: [],
          capabilities: ['collection.Uploads.update'],
          routes: ['PATCH /uploads/[uuid]'],
        });
      }
      return Response.json({ UUID: 'u', email: 'admin@example.com', roles: ['admin'] });
    });
    const { sessionUser } = await import('../../../../src/dashboard/runtime/session.ts');
    const { dashboardMeta } = await import('../../../../src/dashboard/runtime/meta.ts');
    sessionUser();
    await settle();
    dashboardMeta();
    await settle();
    popup = await import('../../../../src/uploads/dashboard/components/media-details-popup.ts');
  });

  /**
   * The popup over a PDF on its Description tab, with lookups into its live tree.
   */
  function open() {
    const scope = effectScope();
    const handle = scope.run(() =>
      popup.mediaDetailsPopup(RECORD, { tab: 'description', onClose() {} }),
    );
    const root = handle.root as unknown as FakeElement;
    const find = (match: (element: FakeElement) => boolean) => findElement(root, match);
    const labelled = (label: string) =>
      find((element) => (element.getAttribute('aria-label') ?? '').startsWith(label));
    const click = (element: FakeElement | undefined): void => {
      fire(element!, 'click');
      flush();
    };
    return {
      scope,
      description: () =>
        find(
          (element) => (element as unknown as { id?: string }).id === 'field-description-input',
        ) as (FakeElement & { value: string }) | undefined,
      knob: () =>
        find((element) => hasClass(element, 'ohne-switch-control')) as
          | (FakeElement & { checked: boolean })
          | undefined,
      tab: (label: string) =>
        click(
          find(
            (element) =>
              hasClass(element, 'ohne-button-group-item') && element.textContent.includes(label),
          ),
        ),
      undo: () => click(labelled('dashboard.history.undo')),
      redo: () => click(labelled('dashboard.history.redo')),
    };
  }

  it('switches to the tab whose change a step takes back, restoring the description in place', async () => {
    const { scope, description, knob, tab, undo, redo } = open();
    await settle();
    const input = description()!;
    type(input, 'A red fox');
    tab('uploads.dashboard.details');
    await settle();
    strictEqual(description(), undefined);
    const toggle = knob()!;
    toggle.checked = true;
    fire(toggle, 'change');
    flush();
    undo();
    await settle();
    strictEqual(knob()?.checked, false);
    undo();
    await settle();
    strictEqual(knob(), undefined);
    strictEqual(description(), input);
    strictEqual(input.value, '');
    redo();
    await settle();
    strictEqual(input.value, 'A red fox');
    redo();
    await settle();
    strictEqual(description(), undefined);
    strictEqual(knob()?.checked, true);
    scope.dispose();
  });
});
