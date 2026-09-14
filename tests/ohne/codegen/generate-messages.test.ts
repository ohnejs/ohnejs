import { deepStrictEqual, rejects, strictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';

import { BANNER } from '../../../src/ohne/codegen/codegen-dir.ts';
import { generateMessages, loadLayers, useLayers } from '../../../src/ohne/index.ts';

interface PackageSpec {
  name: string;
  ohne?: boolean;
  dependencies?: Record<string, string>;
}

describe('generateMessages', () => {
  let root: string;

  function writePackage(at: string, spec: PackageSpec): void {
    mkdirSync(at, { recursive: true });
    const { ohne, ...manifest } = spec;
    writeFileSync(join(at, 'package.json'), JSON.stringify({ ...manifest, type: 'module' }));
    if (ohne) writeFileSync(join(at, 'ohne.config.ts'), '');
  }

  function writeMessages(layerDir: string, relative: string, data: unknown): void {
    const file = join(layerDir, 'messages', relative);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, JSON.stringify(data));
  }

  function bucket(paths: string[], name: 'shared' | 'node' | 'browser'): string {
    const path = paths.find((p) => p.endsWith(`/.ohne/${name}/messages.ts`));
    if (path === undefined) throw new Error(`no ${name} bucket in ${paths.join(', ')}`);
    return readFileSync(path, 'utf8');
  }

  before(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'ohne-gen-messages-')));
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  afterEach(() => {
    for (const layer of useLayers().layers()) useLayers().remove(layer.path);
  });

  it('types keys and languages in shared, registers catalogs in node, augments browser', async () => {
    const app = join(root, 'app');
    writePackage(app, { name: 'app', ohne: true });
    writeMessages(app, 'en.json', {
      'field.required': 'This field is required',
      'field.minLength': 'Must be at least {min} {min, plural, one {character} other {characters}}',
    });
    writeMessages(app, 'de.json', {
      'field.required': 'Pflichtfeld',
      'field.minLength': 'Mindestens {min, plural, one {# Zeichen} other {# Zeichen}}',
    });

    await loadLayers(app);
    const paths = await generateMessages(app);

    const shared = bucket(paths, 'shared');
    strictEqual(shared.includes('export interface GeneratedMessages {'), true);
    strictEqual(shared.includes("'field.required': {};"), true);
    strictEqual(shared.includes("'field.minLength': { min: number };"), true);
    strictEqual(shared.includes('export interface GeneratedLanguages {'), true);
    strictEqual(shared.includes('de: true;'), true);
    strictEqual(shared.includes('en: true;'), true);
    strictEqual(
      shared.includes(
        'export type GeneratedLanguage = [keyof GeneratedLanguages] extends [never] ? string : keyof GeneratedLanguages;',
      ),
      true,
    );

    const node = bucket(paths, 'node');
    strictEqual(node.includes("import { useMessages } from 'ohnejs';"), true);
    strictEqual(node.includes('interface KnownMessages extends GeneratedMessages {}'), true);
    strictEqual(node.includes('interface KnownLanguages extends GeneratedLanguages {}'), true);
    strictEqual(node.includes('const messages = useMessages();'), true);
    strictEqual(node.includes("messages.register('en', {"), true);
    strictEqual(node.includes("messages.register('de', {"), true);
    strictEqual(node.includes("'field.required': 'This field is required',"), true);
    // The key body lives in shared, not duplicated into node.
    strictEqual(node.includes("'field.minLength': { min: number };"), false);

    const browser = bucket(paths, 'browser');
    strictEqual(browser.includes("declare module 'ohnejs/dashboard' {"), true);
    strictEqual(browser.includes('interface KnownMessages extends GeneratedMessages {}'), true);
    strictEqual(
      browser.includes('interface DashboardLanguages extends GeneratedLanguages {}'),
      true,
    );
    strictEqual(browser.includes('This field is required'), false);
  });

  it('drops disabled keys from the shared types and the node catalog', async () => {
    const app = join(root, 'disabled');
    writePackage(app, { name: 'disabled', ohne: true });
    writeFileSync(
      join(app, 'ohne.config.ts'),
      "export default { disable: { messages: ['secret.**'] } }\n",
    );
    writeMessages(app, 'en.json', {
      'field.required': 'This field is required',
      'secret.token': 'do not ship',
    });

    await loadLayers(app);
    const paths = await generateMessages(app);

    strictEqual(bucket(paths, 'shared').includes("'field.required'"), true);
    strictEqual(bucket(paths, 'shared').includes('secret.token'), false);
    strictEqual(bucket(paths, 'node').includes('do not ship'), false);
  });

  it('types a select parameter as a union of its keywords', async () => {
    const app = join(root, 'select');
    writePackage(app, { name: 'select', ohne: true });
    writeMessages(app, 'en.json', {
      status: '{state, select, active {Active} paused {Paused} other {Unknown}}',
    });

    await loadLayers(app);
    const shared = bucket(await generateMessages(app), 'shared');
    strictEqual(shared.includes("status: { state: 'active' | 'paused' };"), true);
  });

  it('throws when a key has different parameters across languages', async () => {
    const app = join(root, 'mismatch');
    writePackage(app, { name: 'mismatch', ohne: true });
    writeMessages(app, 'en.json', { greeting: 'Hi {name}' });
    writeMessages(app, 'de.json', { greeting: 'Hallo {count, number}' });

    await loadLayers(app);
    await rejects(
      generateMessages(app),
      /Message `greeting` has different parameters across languages/,
    );
  });

  it('throws on a malformed ICU template', async () => {
    const app = join(root, 'malformed');
    writePackage(app, { name: 'malformed', ohne: true });
    writeMessages(app, 'en.json', { broken: 'Hello {name' });

    await loadLayers(app);
    await rejects(generateMessages(app), /Invalid message `broken` for `en`/);
  });

  it('emits empty interfaces and a value-free node file when there are no messages', async () => {
    const app = join(root, 'empty');
    writePackage(app, { name: 'empty', ohne: true });

    await loadLayers(app);
    const paths = await generateMessages(app);

    strictEqual(
      bucket(paths, 'shared'),
      `${BANNER}\n` +
        'export interface GeneratedMessages {}\n' +
        '\n' +
        'export interface GeneratedLanguages {}\n' +
        '\n' +
        'export type GeneratedLanguage = [keyof GeneratedLanguages] extends [never] ? string : keyof GeneratedLanguages;\n',
    );
    strictEqual(
      bucket(paths, 'node'),
      `${BANNER}\n` +
        "import type { GeneratedLanguages, GeneratedMessages } from '../shared/messages.ts';\n" +
        '\n' +
        "declare module 'ohnejs' {\n" +
        '  interface KnownMessages extends GeneratedMessages {}\n' +
        '  interface KnownLanguages extends GeneratedLanguages {}\n' +
        '}\n',
    );
    strictEqual(
      bucket(paths, 'browser'),
      `${BANNER}\n` +
        "import type {} from 'ohnejs/dashboard';\n" +
        "import type { GeneratedLanguages, GeneratedMessages } from '../shared/messages.ts';\n" +
        '\n' +
        "declare module 'ohnejs/dashboard' {\n" +
        '  interface KnownMessages extends GeneratedMessages {}\n' +
        '  interface DashboardLanguages extends GeneratedLanguages {}\n' +
        '}\n',
    );
  });

  it('returns no paths when no package.json is found', async () => {
    deepStrictEqual(await generateMessages(join(root, 'nowhere')), []);
  });
});
