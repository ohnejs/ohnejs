import { deepStrictEqual, strictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { collectMessages, type MessageMeta, type OhneLayer } from '../../../src/ohne/index.ts';

describe('collectMessages', () => {
  let root: string;

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'ohne-collect-messages-'));
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

  async function byKey(layers: OhneLayer[]): Promise<Map<string, MessageMeta>> {
    return new Map((await collectMessages(layers)).map((m) => [m.key, m]));
  }

  it('lets a closer layer override a key', async () => {
    const base = layer('base1', { 'en.json': { greeting: 'Hi' } });
    const app = layer('app1', { 'en.json': { greeting: 'Hello' } });
    const greeting = (await byKey([base, app])).get('greeting');
    strictEqual(greeting?.template, 'Hello');
    strictEqual(greeting?.layer, 'app1');
  });

  it('merges per key, leaving a further layer key untouched', async () => {
    const base = layer('base2', { 'en.json': { a: 'A', b: 'B' } });
    const app = layer('app2', { 'en.json': { b: 'B2' } });
    const keys = await byKey([base, app]);
    strictEqual(keys.get('a')?.template, 'A');
    strictEqual(keys.get('a')?.layer, 'base2');
    strictEqual(keys.get('b')?.template, 'B2');
    strictEqual(keys.get('b')?.layer, 'app2');
  });

  it('overrides one subdirectory key and adds another across layers', async () => {
    const base = layer('base3', { 'en.json': { foo: 'f', 'group.bar': 'barBase' } });
    const app = layer('app3', { 'group/en.json': { bar: 'barApp', baz: 'bazApp' } });
    const keys = await byKey([base, app]);
    strictEqual(keys.get('foo')?.template, 'f');
    strictEqual(keys.get('group.bar')?.template, 'barApp');
    strictEqual(keys.get('group.bar')?.layer, 'app3');
    strictEqual(keys.get('group.baz')?.template, 'bazApp');
  });

  it('keeps the same key in different languages', async () => {
    const base = layer('base4', { 'en.json': { hi: 'Hi' } });
    const app = layer('app4', { 'de.json': { hi: 'Hallo' } });
    deepStrictEqual(
      (await collectMessages([base, app])).map((m) => ({
        key: m.key,
        language: m.language,
        template: m.template,
      })),
      [
        { key: 'hi', language: 'de', template: 'Hallo' },
        { key: 'hi', language: 'en', template: 'Hi' },
      ],
    );
  });

  it('sorts the result by language, then key', async () => {
    const base = layer('base5', { 'en.json': { b: 'B', a: 'A' }, 'de.json': { z: 'Z' } });
    deepStrictEqual(
      (await collectMessages([base])).map((m) => `${m.language}/${m.key}`),
      ['de/z', 'en/a', 'en/b'],
    );
  });
});
