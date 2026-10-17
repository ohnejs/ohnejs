import { deepStrictEqual, strictEqual } from 'node:assert';
import { before, describe, it, mock } from 'node:test';

import type { DashboardField } from '../../../../src/dashboard/runtime/meta-types.ts';

import { flush } from '../../../../src/utils/reactive/_scheduler.ts';
import { effectScope } from '../../../../src/utils/reactive/effect-scope.ts';
import { type FakeElement, findElement, hasClass } from '../../_fake-dom.ts';
import { fire } from '../../ui/_events.ts';
import '../_controls.ts';

const { recordsType } = await import('../../../../src/dashboard/fields/builtin/records.ts');
const { dashboardMeta } = await import('../../../../src/dashboard/runtime/meta.ts');
const { seedLabel } = await import('../../../../src/dashboard/fields/labels.ts');
const { sessionUser } = await import('../../../../src/dashboard/runtime/session.ts');

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

const TAGS = {
  name: 'Tags',
  segment: 'tags',
  label: 'Tags',
  translatable: false,
  singleton: false,
  operations: {
    read: { allowed: true, public: false, scoped: false },
    create: null,
    update: null,
    delete: null,
  },
  fields: [],
  labelFields: ['name'],
};

const TAGGED: DashboardField = {
  name: 'tags',
  type: 'records',
  kind: 'childMany',
  label: 'Tags',
  nullable: false,
  required: false,
  unique: false,
  translatable: false,
  readable: true,
  writable: true,
  immutable: false,
  target: 'Tags',
  options: { min: 2 },
};

async function settle(): Promise<void> {
  for (let i = 0; i < 3; i++) await new Promise((resolve) => setImmediate(resolve));
  flush();
}

function control(initial: unknown) {
  return recordsType.control!({
    field: TAGGED,
    initial,
    mode: 'edit',
    path: 'tags',
    language: () => 'en',
    onInput() {},
  })!;
}

describe('recordsType control', () => {
  before(async () => {
    mock.method(globalThis, 'fetch', async (url: string) => {
      if (!url.endsWith('/dashboard')) return new Response(JSON.stringify(ADMIN));
      const meta = { collections: [TAGS], locales: [], menu: [], blocks: [] };
      return new Response(JSON.stringify(meta));
    });
    sessionUser();
    await settle();
    dashboardMeta();
    await settle();
    seedLabel('Tags', 't1', 'Raid');
    seedLabel('Tags', 't2', 'Lore');
  });

  it('drafts a changed list below `min`, which `read` refuses', async () => {
    await effectScope().run(async () => {
      const tags = control(['t1', 't2']);
      await settle();
      const remove = findElement(tags.element as unknown as FakeElement, (element) =>
        hasClass(element, 'ohne-dynamic-chips-remove'),
      ) as FakeElement;
      fire(remove, 'click');
      flush();
      deepStrictEqual(tags.draft?.(), ['t2']);
      deepStrictEqual(tags.read(), { errors: { '': 'validation.minItems' } });
      strictEqual(control(undefined).draft?.(), undefined);
    });
  });

  it('restores a list in place, keeping the chips field, dirty against the stored one', async () => {
    await effectScope().run(async () => {
      const tags = control(['t1', 't2']);
      await settle();
      const chips = findElement(tags.element as unknown as FakeElement, (element) =>
        hasClass(element, 'ohne-dynamic-chips'),
      );
      tags.restore?.(['t2']);
      await settle();
      deepStrictEqual(tags.draft?.(), ['t2']);
      strictEqual(tags.dirty(), true);
      strictEqual(
        findElement(tags.element as unknown as FakeElement, (element) =>
          hasClass(element, 'ohne-dynamic-chips'),
        ),
        chips,
      );
      tags.restore?.(['t1', 't2']);
      strictEqual(tags.dirty(), false);
      deepStrictEqual(tags.read(), { value: ['t1', 't2'] });
    });
  });
});
