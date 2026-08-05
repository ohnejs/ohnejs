import { deepStrictEqual, rejects } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { type OhneLayer, scanLayerMessages } from '../../../src/ohne/index.ts';

describe('scanLayerMessages', () => {
  let root: string;

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'ohne-scan-layer-messages-'));
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function layer(name: string, files: Record<string, unknown>): OhneLayer {
    const dir = join(root, name);
    for (const [relative, data] of Object.entries(files)) {
      const file = join(dir, 'messages', relative);
      mkdirSync(join(file, '..'), { recursive: true });
      writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data));
    }
    return { name, dir };
  }

  async function read(
    l: OhneLayer,
  ): Promise<{ key: string; language: string; template: string }[]> {
    const messages = await scanLayerMessages(l, 'messages');
    return messages
      .map((m) => ({ key: m.key, language: m.language, template: m.template }))
      .sort((a, b) => a.key.localeCompare(b.key) || a.language.localeCompare(b.language));
  }

  it('reads flat dotted keys', async () => {
    deepStrictEqual(
      await read(layer('flat', { 'en.json': { 'field.required': 'r', 'dashboard.save': 'Save' } })),
      [
        { key: 'dashboard.save', language: 'en', template: 'Save' },
        { key: 'field.required', language: 'en', template: 'r' },
      ],
    );
  });

  it('skips underscore-prefixed helper files and directories', async () => {
    deepStrictEqual(
      await read(
        layer('helpers', {
          'en.json': { save: 'Save' },
          '_de.json': { save: 'Entwurf' },
          '_drafts/en.json': { discard: 'Discard' },
        }),
      ),
      [{ key: 'save', language: 'en', template: 'Save' }],
    );
  });

  it('flattens nested objects to dot keys', async () => {
    deepStrictEqual(
      await read(layer('nested', { 'en.json': { field: { required: 'r', minLength: 'm' } } })),
      [
        { key: 'field.minLength', language: 'en', template: 'm' },
        { key: 'field.required', language: 'en', template: 'r' },
      ],
    );
  });

  it('prefixes keys with the subdirectory name', async () => {
    deepStrictEqual(await read(layer('subdir', { 'dashboard/en.json': { save: 'Save' } })), [
      { key: 'dashboard.save', language: 'en', template: 'Save' },
    ]);
  });

  it('canonicalizes the language from the file stem', async () => {
    deepStrictEqual(await read(layer('canon', { 'de-at.json': { hello: 'Hallo' } })), [
      { key: 'hello', language: 'de-AT', template: 'Hallo' },
    ]);
  });

  it('keeps the same key in different languages', async () => {
    deepStrictEqual(
      await read(layer('langs', { 'en.json': { hi: 'Hi' }, 'de.json': { hi: 'Hallo' } })),
      [
        { key: 'hi', language: 'de', template: 'Hallo' },
        { key: 'hi', language: 'en', template: 'Hi' },
      ],
    );
  });

  it('returns an empty list when the layer has no messages directory', async () => {
    deepStrictEqual(
      await scanLayerMessages({ name: 'bare', dir: join(root, 'bare') }, 'messages'),
      [],
    );
  });

  it('throws when a dotted key and a subdirectory key collide in one layer', async () => {
    const l = layer('dup', { 'en.json': { 'group.bar': 'a' }, 'group/en.json': { bar: 'b' } });
    await rejects(scanLayerMessages(l, 'messages'), /Duplicate message `group\.bar` for `en`/);
  });

  it('throws when a nested key and a literal dotted key collide in one file', async () => {
    const l = layer('dupfile', {
      'en.json': { api: { notFound: 'nested value' }, 'api.notFound': 'literal value' },
    });
    await rejects(scanLayerMessages(l, 'messages'), /Duplicate message `api\.notFound` for `en`/);
  });

  it('throws when a file is not named after a valid language tag', async () => {
    const l = layer('badlang', { 'en_US.json': { hi: 'Hi' } });
    await rejects(scanLayerMessages(l, 'messages'), /Invalid message language `en_US`/);
  });

  it('throws when a message value is not a string', async () => {
    const l = layer('nonstring', { 'en.json': { count: 5 } });
    await rejects(scanLayerMessages(l, 'messages'), /Message `count` is not a string/);
  });

  it('throws when a file does not hold a JSON object', async () => {
    const l = layer('badjson', { 'en.json': '["not", "an", "object"]' });
    await rejects(scanLayerMessages(l, 'messages'), /Invalid message file/);
  });
});
