import { strictEqual } from 'node:assert';
import { before, describe, it, mock } from 'node:test';

import type { DashboardField } from '../../../src/dashboard/runtime/meta-types.ts';

import { flush } from '../../../src/utils/reactive/_scheduler.ts';
import { ref } from '../../../src/utils/reactive/ref.ts';
import { type FakeElement, findElement, hasClass } from '../_fake-dom.ts';
import '../ui/_events.ts';

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

  it('shows the description, the error in its place, and the required mark through one frame', () => {
    const error = ref('');
    const row = fieldRow(
      {
        field: { ...FIELD, required: true, description: 'Shown on the roster' },
        path: 'title',
        error: () => error.value,
      },
      null,
    ) as unknown as FakeElement;
    const part = (name: string) => findElement(row, (element) => hasClass(element, name));
    strictEqual((row as unknown as HTMLElement).id, 'field-title');
    strictEqual(hasClass(row, 'ohne-field'), true);
    strictEqual(
      hasClass(part('ohne-field-label') as FakeElement, 'ohne-field-label-required'),
      true,
    );
    strictEqual(part('ohne-prose')?.getAttribute('id'), 'field-title-desc');
    strictEqual(part('ohne-prose')?.textContent, 'Shown on the roster');
    error.value = 'Too long for a war banner';
    flush();
    strictEqual(part('ohne-prose')?.textContent, 'Too long for a war banner');
    strictEqual(part('ohne-prose')?.getAttribute('id'), 'field-title-desc');
    strictEqual(
      hasClass(part('ohne-field-message') as FakeElement, 'ohne-field-message-has-errors'),
      true,
    );
  });
});
