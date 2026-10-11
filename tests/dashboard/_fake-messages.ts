import { mock } from 'node:test';

import './_fake-dom.ts';

/**
 * Serves `templates` as the English `app` message group and loads it before any test renders.
 * Call it before the first translation: the dashboard config and its message groups are read once.
 */
export async function seedMessages(templates: Record<string, string>): Promise<void> {
  const { loadLanguage } = await import('../../src/dashboard/runtime/messages.ts');
  Object.assign(document, {
    getElementById: () => ({
      textContent: JSON.stringify({
        apiURL: 'http://api',
        defaultLanguage: 'en',
        messageGroups: ['app'],
      }),
    }),
  });
  const catalog = Object.fromEntries(
    Object.entries(templates).map(([key, template]) => [key, { template, language: 'en' }]),
  );
  mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(catalog)));
  await loadLanguage('en');
}
