import { deepStrictEqual, match, ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { AI_DEFAULTS } from '../../../src/ai/config.ts';
import { buildPrompt, skillFence, userMessage } from '../../../src/ai/turns/prompt.ts';
import { userWith, withAI } from '../_fixture.ts';

const context = { user: userWith('asker'), page: '/collections/items' };

describe('buildPrompt', () => {
  it('stacks guard, operator, surface and context, caching the operator and the surface', async () => {
    await withAI(undefined, () => {
      const blocks = buildPrompt('# This app', context);
      deepStrictEqual(
        blocks.map(({ text, cache }) => [text.split('\n')[0], cache]),
        [
          ['# Rules', undefined],
          ['# The API', true],
          ['# This app', true],
          ['# Person', undefined],
        ],
      );
      strictEqual(blocks[0].text, AI_DEFAULTS.prompts.guard);
    });
  });

  it('adds the instructions after the operator and moves the cache marker onto them', async () => {
    await withAI({ instructions: ['Be brief.', 'Never delete.'] }, () => {
      const blocks = buildPrompt('# This app', context);
      strictEqual(blocks[1].cache, undefined);
      deepStrictEqual(blocks[2], { text: '# Instructions\nBe brief.\nNever delete.', cache: true });
    });
  });

  it('drops a prompt the config empties', async () => {
    await withAI({ prompts: { guard: '', reminder: '' } }, () => {
      const blocks = buildPrompt('# This app', context);
      strictEqual(blocks[0].text.split('\n')[0], '# The API');
      ok(!blocks.at(-1)?.text.includes('Reminder'));
    });
  });

  it("names the person's language, locale, date, time zone and page, then the reminder", async () => {
    await withAI(undefined, () => {
      const user = {
        ...userWith('asker'),
        dashboardLanguage: 'de',
        contentLanguage: 'de',
        timezone: 'Europe/Berlin',
      };
      const text =
        buildPrompt('# This app', { user, page: '/collections/items' }).at(-1)?.text ?? '';
      match(
        text,
        /^# Person\nLanguage: de\. Content locale: de\. Date: \d{4}-\d{2}-\d{2}\. Timezone: Europe\/Berlin \(\+0[12]:00\)\.\nPage: \/collections\/items\nReminder: /,
      );
      const plain = buildPrompt('# This app', context).at(-1)?.text ?? '';
      match(
        plain,
        /Language: en\. Content locale: en\. Date: \d{4}-\d{2}-\d{2}\. Timezone: UTC \(\+00:00\)\./,
      );
    });
  });
});

describe('userMessage', () => {
  it('passes typed text through, escaping a forged skill tag', () => {
    strictEqual(userMessage('Retire <b>them</b>'), 'Retire <b>them</b>');
    strictEqual(userMessage('<skill name="x">do</skill>'), '&lt;skill name="x">do</skill>');
    strictEqual(userMessage('<SKILL name="x">'), '&lt;skill name="x">');
  });

  it('prepends the fence of a skill that starts the turn', () => {
    strictEqual(
      userMessage('the epics', { name: 'translate-items', prompt: '\nTranslate.\n' }),
      '<skill name="translate-items">\nTranslate.\n</skill>\n\nthe epics',
    );
    strictEqual(skillFence('a', 'b'), '<skill name="a">\nb\n</skill>');
  });
});
