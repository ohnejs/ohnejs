import { doesNotReject, match, ok, rejects } from 'node:assert';
import { describe, it } from 'node:test';

import type { Transaction } from '../../../src/ohne/database/adapter.ts';

import { useBlocks } from '../../../src/ohne/blocks/use-blocks.ts';
import { useCollections } from '../../../src/ohne/collections/use-collections.ts';
import { isOhneError } from '../../../src/ohne/error/ohne-error.ts';
import { field } from '../../../src/ohne/fields/field.ts';
import { validateLiteralDefaults } from '../../../src/ohne/query/validate-literal-defaults.ts';

const tx = {} as Transaction;

async function checkCollection(name: string, fields: Record<string, unknown>): Promise<void> {
  useCollections().register(name, { name, collection: { fields } } as never);
  try {
    await validateLiteralDefaults(tx);
  } finally {
    useCollections().delete(name);
  }
}

async function checkBlock(name: string, fields: Record<string, unknown>): Promise<void> {
  useBlocks().register(name, { name, block: { fields } } as never);
  try {
    await validateLiteralDefaults(tx);
  } finally {
    useBlocks().delete(name);
  }
}

function rejectsTitled(run: Promise<void>, title: string, body?: RegExp): Promise<void> {
  return rejects(run, (error: unknown) => {
    ok(isOhneError(error));
    ok(error.title === title, `title was: ${error.title}`);
    if (body) match([error.body].flat().join('\n'), body);
    return true;
  });
}

describe('validateLiteralDefaults', () => {
  it('accepts a literal default the tiers accept', async () => {
    await doesNotReject(checkCollection('LDOk', { title: field('text', { default: 'x' }) }));
  });

  it("rejects `default: ''` on a text field that forbids the empty string", async () => {
    await rejectsTitled(
      checkCollection('LDEmpty', { body: field('text', { default: '' }) }),
      'Field `body` defaults to a value it rejects',
      /collection `LDEmpty` defaults to `''`\.\n.*validation\.emptyValue\./,
    );
  });

  it("accepts `default: ''` under `allowEmpty`", async () => {
    await doesNotReject(
      checkCollection('LDAllowed', { body: field('text', { default: '', allowEmpty: true }) }),
    );
  });

  it('rejects a select default outside its choices', async () => {
    await rejectsTitled(
      checkCollection('LDChoice', { kind: field('select', { choices: ['a', 'b'], default: 'z' }) }),
      'Field `kind` defaults to a value it rejects',
      /defaults to `'z'`\.\n.*validation\.invalidChoice\./,
    );
  });

  it('rejects an integer default below `min`', async () => {
    await rejectsTitled(
      checkCollection('LDMin', { rating: field('integer', { min: 1, default: 0 }) }),
      'Field `rating` defaults to a value it rejects',
      /defaults to `0`\.\n.*validation\.minValue/,
    );
  });

  it('rejects a default that fails the base-type gate', async () => {
    await rejectsTitled(
      checkCollection('LDGate', { views: field('integer', { default: 'x' as never }) }),
      'Field `views` defaults to a value it rejects',
      /validation\.invalidValue\./,
    );
  });

  it('rejects a default an instance validator refuses', async () => {
    await rejectsTitled(
      checkCollection('LDOwn', {
        code: field('text', {
          default: 'x',
          validators: [(value) => (value === 'x' ? 'no x' : undefined)],
        }),
      }),
      'Field `code` defaults to a value it rejects',
      /reject that value: no x\./,
    );
  });

  it('reports a sub-path failure at its path', async () => {
    await rejectsTitled(
      checkCollection('LDSub', { tags: field('multiSelect', { choices: ['a'], default: ['z'] }) }),
      'Field `tags` defaults to a value it rejects',
      /defaults to `\["z"\]`\.\n.*at `tags\[0\]`: validation\.invalidChoice\./,
    );
  });

  it('runs the type sanitizers before its validators', async () => {
    await doesNotReject(
      checkCollection('LDClean', {
        tags: field('multiSelect', { choices: ['a'], max: 1, default: ['a', 'a'] }),
      }),
    );
  });

  it('skips a callback default', async () => {
    await doesNotReject(
      checkCollection('LDCallback', { body: field('text', { default: () => '' }) }),
    );
  });

  it('skips a `null` default', async () => {
    await doesNotReject(
      checkCollection('LDNull', { body: field('text', { nullable: true, default: null }) }),
    );
  });

  it('rejects an empty list default that `min` forbids', async () => {
    await rejectsTitled(
      checkCollection('LDEmptyList', { tags: field('multiSelect', { min: 1, default: [] }) }),
      'Field `tags` defaults to a value it rejects',
      /defaults to `\[\]`\.\n.*validation\.minItems/,
    );
  });

  it('names a nested subfield by its dotted path', async () => {
    await rejectsTitled(
      checkCollection('LDNested', {
        sections: field('repeater', { fields: { heading: field('text', { default: '' }) } }),
      }),
      'Field `sections.heading` defaults to a value it rejects',
      /Field `sections\.heading` in collection `LDNested`/,
    );
  });

  it('walks block fields', async () => {
    await rejectsTitled(
      checkBlock('LDHero', { title: field('text', { default: '' }) }),
      'Field `title` defaults to a value it rejects',
      /Field `title` in block `LDHero` defaults to `''`\./,
    );
  });
});
