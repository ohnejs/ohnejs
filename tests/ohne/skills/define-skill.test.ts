import { deepStrictEqual, strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { defineSkill, isOhneError } from '../../../src/ohne/index.ts';

/**
 * Matches the invalid-definition error whose body names `option`.
 */
function failsOn(option: string): (error: unknown) => boolean {
  return (error) =>
    isOhneError(error) &&
    error.message === 'Invalid skill definition' &&
    String(error.body).startsWith(`\`${option}\` must be`);
}

describe('defineSkill', () => {
  it('returns the definition unchanged', () => {
    const definition = { description: 'Translates items.', prompt: 'Translate each item.' };
    strictEqual(defineSkill(definition), definition);
  });

  it('accepts a title and a description as a string or a `{ key, params }` object', () => {
    const definition = defineSkill({
      title: 'Translate items',
      description: { key: 'dashMenu.tools', params: { n: 2 } },
      prompt: 'Translate each item.',
      capability: 'collection.Items.update',
    });
    strictEqual(definition.title, 'Translate items');
    deepStrictEqual(definition.description, { key: 'dashMenu.tools', params: { n: 2 } });
    strictEqual(definition.capability, 'collection.Items.update');
  });

  it('rejects a missing description or one of another shape', () => {
    throws(() => defineSkill({ prompt: 'x' } as never), failsOn('description'));
    throws(
      () => defineSkill({ description: { params: {} } as never, prompt: 'x' }),
      failsOn('description'),
    );
  });

  it('rejects a title of another shape', () => {
    throws(
      () => defineSkill({ title: 1 as never, description: 'd', prompt: 'x' }),
      failsOn('title'),
    );
  });

  it('takes a prompt as a list of lines, and rejects a missing, blank or mistyped one', () => {
    defineSkill({ description: 'd', prompt: ['Read first.', 'Then write.'] });
    throws(() => defineSkill({ description: 'd' } as never), failsOn('prompt'));
    throws(() => defineSkill({ description: 'd', prompt: '' }), failsOn('prompt'));
    throws(() => defineSkill({ description: 'd', prompt: ['', ' '] }), failsOn('prompt'));
    throws(() => defineSkill({ description: 'd', prompt: 1 as never }), failsOn('prompt'));
  });

  it('rejects an empty or non-string capability', () => {
    throws(
      () => defineSkill({ description: 'd', prompt: 'x', capability: '' }),
      failsOn('capability'),
    );
    throws(
      () => defineSkill({ description: 'd', prompt: 'x', capability: 1 as never }),
      failsOn('capability'),
    );
  });
});
