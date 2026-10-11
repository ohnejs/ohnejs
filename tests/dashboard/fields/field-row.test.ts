import { strictEqual } from 'node:assert';
import { before, describe, it, mock } from 'node:test';

import type { DashboardField } from '../../../src/dashboard/runtime/meta-types.ts';

import { flush } from '../../../src/utils/reactive/_scheduler.ts';
import { type FakeElement, findElement, hasClass } from '../_fake-dom.ts';

const { fieldRow } = await import('../../../src/dashboard/fields/field-row.ts');
const { loadLanguage } = await import('../../../src/dashboard/runtime/messages.ts');
const { requestDashboardLanguage } =
  await import('../../../src/dashboard/runtime/set-dashboard-language.ts');

const FIELD: DashboardField = {
  name: 'title',
  type: 'text',
  kind: 'column',
  label: 'app.title.label',
  nullable: false,
  required: false,
  unique: false,
  translatable: false,
  readable: true,
  writable: true,
  immutable: false,
};

/**
 * Lets pending fetches and their continuations settle, then runs every queued effect.
 */
async function settle(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  flush();
}

describe('fieldRow', () => {
  before(async () => {
    Object.assign(document, {
      getElementById: () => ({
        textContent: JSON.stringify({
          apiURL: 'http://api',
          defaultLanguage: 'en',
          messageGroups: ['app'],
        }),
      }),
    });
    mock.method(globalThis, 'fetch', async (url: string) => {
      const template = url.endsWith('/de') ? 'Titel' : 'Title';
      return new Response(JSON.stringify({ 'app.title.label': { template, language: 'en' } }));
    });
    await loadLanguage('en');
  });

  it('translates its label and follows a language switch in place', async () => {
    const row = fieldRow({ field: FIELD, path: 'title' }, null) as unknown as FakeElement;
    const label = findElement(row, (element) => hasClass(element, 'ohne-label'));
    strictEqual(label?.textContent, 'Title');
    await loadLanguage('de');
    requestDashboardLanguage('de');
    await settle();
    strictEqual(
      findElement(row, (element) => hasClass(element, 'ohne-label')),
      label,
    );
    strictEqual(label?.textContent, 'Titel');
  });
});
