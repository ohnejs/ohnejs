import { deepStrictEqual, strictEqual } from 'node:assert';
import { before, describe, it, mock } from 'node:test';

import type { DashboardField } from '../../../../src/dashboard/runtime/meta-types.ts';

import { flush } from '../../../../src/utils/reactive/_scheduler.ts';
import { effectScope } from '../../../../src/utils/reactive/effect-scope.ts';
import '../_controls.ts';

const { createFieldForm } = await import('../../../../src/dashboard/fields/field-form.ts');
const { dashboardMeta } = await import('../../../../src/dashboard/runtime/meta.ts');
const { sessionUser } = await import('../../../../src/dashboard/runtime/session.ts');
await import('../../../../src/dashboard/fields/builtin/text.ts');
await import('../../../../src/dashboard/fields/builtin/blocks.ts');

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

const TITLE: DashboardField = {
  name: 'title',
  type: 'text',
  kind: 'column',
  logicalType: 'text',
  label: 'Title',
  nullable: false,
  required: true,
  unique: false,
  translatable: false,
  readable: true,
  writable: true,
  immutable: false,
};

const SECTIONS = {
  ...TITLE,
  name: 'sections',
  type: 'blocks',
  kind: 'childMany',
  logicalType: undefined,
  label: 'Sections',
  required: false,
  allow: ['Hero'],
} as DashboardField;

async function settle(): Promise<void> {
  for (let i = 0; i < 3; i++) await new Promise((resolve) => setImmediate(resolve));
  flush();
}

describe('blocksType control', () => {
  before(async () => {
    Object.assign(document, {
      getElementById: () => ({
        textContent: JSON.stringify({
          apiURL: 'http://api',
          defaultLanguage: 'en',
          messageGroups: [],
        }),
      }),
    });
    mock.method(globalThis, 'fetch', async (url: string) => {
      if (!url.endsWith('/dashboard')) return new Response(JSON.stringify(ADMIN));
      const blocks = [{ name: 'Hero', label: 'Hero', fields: [TITLE] }];
      return new Response(JSON.stringify({ collections: [], locales: [], menu: [], blocks }));
    });
    sessionUser();
    await settle();
    dashboardMeta();
    await settle();
  });

  it('reads an empty required field in a new block quietly, and routes it back through `setErrors`', () => {
    effectScope().run(() => {
      const form = createFieldForm(
        [SECTIONS],
        { sections: [{ block: 'Hero', fields: {} }] },
        { mode: 'edit', path: '', language: () => 'en' },
      );
      const reading = form.read();
      deepStrictEqual(structuredClone(reading), {
        errors: { 'sections[0].fields.title': 'validation.required' },
      });
      deepStrictEqual(form.snapshot(), {});
      strictEqual(form.errored(), false);
      strictEqual(form.setErrors(reading.errors ?? {}), '');
      strictEqual(form.controlOf('sections')?.errored?.(), true);
      strictEqual(form.setErrors({}), '');
      strictEqual(form.errored(), false);
    });
  });
});
